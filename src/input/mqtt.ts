import { Readable } from "stream";
import { IClientOptions, connect } from "mqtt";
import { match, P } from "ts-pattern";
import { AsyncQueue, Channel, flatMap } from "../async-queue";
import {
  Event,
  arrivalTimestamp,
  makeNewEventParser,
  parseChannel,
  WrapDirective,
  wrapDirectiveSchema,
  chooseParser,
  makeWrapper,
  validateWrap,
} from "../event";
import { makeLogger } from "../log";
import { backpressure } from "../metrics";
import { check, makeFuse } from "../utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/mqtt");

/**
 * Options for this input form.
 */
export type MQTTInputOptions =
  | string
  | {
      url: string;
      options?: IClientOptions;
      topic?: string | string[] | Record<string, { qos: 0 | 1 | 2 }>;
      wrap?: WrapDirective;
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
        topic: {
          anyOf: [
            { type: "string", minLength: 1 },
            {
              type: "array",
              items: { type: "string", minLength: 1 },
              minItems: 1,
            },
            {
              type: "object",
              properties: {},
              minProperties: 1,
              propertyNames: { minLength: 1 },
              additionalProperties: {
                type: "object",
                properties: { qos: { enum: [0, 1, 2] } },
                additionalProperties: false,
                required: ["qos"],
              },
            },
          ],
        },
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["url"],
    },
  ],
};

/**
 * Validate mqtt input options, after they've been checked by the ajv
 * schema.
 *
 * @param options The options to validate.
 */
export const validate = (options: MQTTInputOptions): void => {
  // TODO: validate mqtt connection options
  check(
    match(options).with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
};

/**
 * Default topic to subscribe to, when no topic is specified.
 */
const DEFAULT_TOPIC = "cdp/#";

/**
 * Creates an input channel based on data received from a MQTT broker.
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The MQTT connection options to configure the input
 * channel.
 * @returns A channel that receives data from a MQTT broker and
 * forwards parsed events, and a promise that resolves when the input
 * ends for any reason.
 */
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options: MQTTInputOptions
): [Channel<never, Event>, Promise<void>] => {
  const url = typeof options === "string" ? options : options.url;
  const topic =
    typeof options === "string"
      ? DEFAULT_TOPIC
      : options.topic ?? DEFAULT_TOPIC;
  const parse = chooseParser(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);

  const channel = flatMap(async (message: string) => {
    arrivalTimestamp.update();
    const things = [];
    for await (const thing of parse(Readable.from([message]))) {
      things.push(wrapper(thing));
    }
    return things;
  }, new AsyncQueue<string>("input.mqtt").asChannel());
  const done = makeFuse();

  const client =
    typeof options === "string" || typeof options.options === "undefined"
      ? connect(url)
      : connect(url, options.options);
  // Emit backpressure as documented here:
  // https://github.com/mqttjs/MQTT.js#mqttclienthandlemessagepacket-callback
  client.handleMessage = (_, callback) => {
    if (backpressure.status()) {
      backpressure.once("off", () => callback());
    } else {
      callback();
    }
  };
  client.on("error", (err) => {
    logger.error(`MQTT client notified an error: ${err}`);
    done.trigger();
  });
  client.on("connect", () => {
    logger.debug("MQTT client connected successfully");
    client.subscribe(topic, (err) => {
      if (err) {
        logger.error(`Error when subscribing to MQTT topic(s): ${err}`);
        done.trigger();
      }
    });
  });
  client.on("message", (topic, message) => {
    logger.debug("Got message from MQTT topic", topic, ":", message);
    channel.send(message.toString());
  });

  const consuming = done.promise.then(
    () =>
      new Promise((resolve) =>
        client.end(false, {}, () => resolve())
      ) as Promise<void>
  );

  // Assemble the event channel.
  return [
    parseChannel(
      {
        ...channel,
        send: () => {
          logger.warn("Can't send events to an input channel");
          return false;
        },
        close: async () => {
          done.trigger();
          await consuming;
          await channel.close();
          logger.debug("Drained mqtt input");
        },
      },
      eventParser,
      "parsing mqtt message"
    ),
    consuming,
  ];
};
