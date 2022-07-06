import { IClientOptions, connect } from "mqtt";
import { match, P } from "ts-pattern";
import { AsyncQueue, Channel, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { check } from "../utils";
import { PipelineStepFunctionParameters, makeProcessorChannel } from ".";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/send-mqtt");

/**
 * Options for this function.
 */
export type SendMQTTFunctionOptions =
  | string
  | {
      url: string;
      options?: IClientOptions;
      topic?: string;
      qos?: 0 | 1 | 2;
      "jq-expr"?: string;
      "jsonnet-expr"?: string;
    };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: {
        url: { type: "string", minLength: 1 },
        options: { type: "object" },
        topic: { type: "string", minLength: 1 },
        qos: { enum: [0, 1, 2] },
        "jq-expr": { type: "string", minLength: 1 },
        "jsonnet-expr": { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      required: ["url"],
    },
  ],
};

/**
 * Validate send-mqtt options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendMQTTFunctionOptions
): void => {
  // TODO: validate mqtt connection options
  check(
    match(options).with(
      { "jq-expr": P.string, "jsonnet-expr": P.string },
      () => false
    ),
    `step '${name}' can't use both jq and jsonnet expressions simultaneously`
  );
};

/**
 * Default topic to publish to, when no topic is specified.
 */
const defaultTopic = (pipelineName: string, stepName: string) =>
  `cdp/${pipelineName}/${stepName}`;

/**
 * Function that sends events to a MQTT broker, and forwards the same
 * events to the rest of the pipeline unmodified.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate how to connect and send
 * events to the MQTT broker.
 * @returns A channel that forwards events to a MQTT broker.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: SendMQTTFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const url = typeof options === "string" ? options : options.url;
  const topic =
    typeof options === "string" || typeof options.topic === "undefined"
      ? defaultTopic(params.pipelineName, params.stepName)
      : options.topic;
  const qos =
    typeof options === "string" || typeof options.qos === "undefined"
      ? 0
      : options.qos;
  const client =
    typeof options === "string" || typeof options.options === "undefined"
      ? connect(url, {})
      : connect(url, options.options);
  client.on("error", (err) =>
    logger.error(`MQTT client notified an error: ${err}`)
  );

  let passThroughChannel: Channel<Event[], never>;
  if (
    typeof options !== "string" &&
    (typeof options["jq-expr"] === "string" ||
      typeof options["jsonnet-expr"] === "string")
  ) {
    passThroughChannel = drain(
      await makeProcessorChannel(params, options),
      async (message: unknown) => {
        await (new Promise((resolve) =>
          client.publish(
            topic,
            typeof message === "string" ? message : JSON.stringify(message),
            {
              qos,
              properties: {
                contentType:
                  typeof message === "string"
                    ? "text/plain"
                    : "application/json",
              },
            },
            (err) => {
              if (err) {
                logger.warn(
                  `MQTT client notified an error while publishing: ${err}`
                );
              }
              resolve();
            }
          )
        ) as Promise<void>);
      }
    );
  } else {
    passThroughChannel = drain(
      new AsyncQueue<Event[]>(
        `step.${params.stepName}.send-mqtt.pass-through`
      ).asChannel(),
      async (events: Event[]) => {
        await (new Promise((resolve) =>
          client.publish(
            topic,
            events.map((e) => JSON.stringify(e)).join("\n") + "\n",
            {
              qos,
              properties: { contentType: "application/x-ndjson" },
            },
            (err) => {
              if (err) {
                logger.warn(
                  `MQTT client notified an error while publishing: ${err}`
                );
              }
              resolve();
            }
          )
        ) as Promise<void>);
      }
    );
  }
  const queue = new AsyncQueue<Event[]>(
    `step.${params.stepName}.send-mqtt.forward`
  );
  const forwardingChannel = flatMap(async (events: Event[]) => {
    passThroughChannel.send(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await passThroughChannel.close();
      await (new Promise((resolve) =>
        client.end(false, {}, () => resolve())
      ) as Promise<void>);
    },
  };
};
