import { connect } from "amqplib";
import { match, P } from "ts-pattern";
import { AsyncQueue, Channel, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { check } from "../utils";
import { processor as jqProcessor } from "../io/jq";
import { processor as jsonnetProcessor } from "../io/jsonnet";
import { PipelineStepFunctionParameters } from ".";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/send-amqp");

/**
 * Extended options for this function.
 */
interface ExtendedSendAMQPFunctionOptions {
  url: string;
  exchange?: {
    name?: string;
    type?: "direct" | "fanout" | "topic";
    durable?: boolean | "true" | "false";
    "auto-delete"?: boolean | "true" | "false";
  };
  "routing-key"?: string;
  expiration?: number | string;
  priority?: number | string;
  persistent?: boolean | "true" | "false";
  "jq-expr"?: string;
  "jsonnet-expr"?: string;
}

/**
 * Options for this function.
 */
export type SendAMQPFunctionOptions = string | ExtendedSendAMQPFunctionOptions;

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  type: "object",
  properties: {
    url: { type: "string", pattern: "^amqps?://.*$" },
    exchange: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        type: { enum: ["direct", "fanout", "topic"] },
        durable: { anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }] },
        "auto-delete": {
          anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }],
        },
      },
      additionalProperties: false,
      required: ["name", "type"],
    },
    "routing-key": { type: "string" },
    expiration: {
      anyOf: [
        { type: "integer", minimum: 1, maximum: 4294967295 },
        { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
      ],
    },
    priority: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 255 },
        { type: "string", pattern: "^[0-9]+$" },
      ],
    },
    persistent: { anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }] },
    "jq-expr": { type: "string", minLength: 1 },
    "jsonnet-expr": { type: "string", minLength: 1 },
  },
  additionalProperties: false,
  required: ["url", "exchange"],
};

/**
 * Validate send-amqp options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendAMQPFunctionOptions
): void => {
  const matchOptions = match(options);
  check(
    matchOptions.with({ expiration: P.select(P.string) }, (seconds) =>
      ((n) => n >= 0 && n <= 4294967295)(parseInt(seconds, 10))
    ),
    `step '${name}' has an invalid value for send-amqp.expiration (must be >= 0 and < 2^32)`
  );
  check(
    matchOptions.with({ priority: P.select(P.string) }, (priority) =>
      ((n) => n >= 0 && n <= 255)(parseInt(priority, 10))
    ),
    `step '${name}' has an invalid value for send-amqp.priority (must be >= 0 and < 256)`
  );
  check(
    matchOptions.with(
      { "jq-expr": P.string, "jsonnet-expr": P.string },
      () => false
    ),
    `step '${name}' can't use both jq and jsonnet expressions simultaneously`
  );
};

/**
 * Default assertion values for the AMQP exchange.
 */
const DEFAULT_EXCHANGE_NAME = "cdp";
const DEFAULT_EXCHANGE_TYPE = "topic";

/**
 * Function that sends events to an AMQP broker, and forwards the same
 * events to the rest of the pipeline unmodified.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param variantOptions The options that indicate how to connect and
 * send events to the AMQP broker.
 * @returns A channel that forwards events to an AMQP broker.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  variantOptions: SendAMQPFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const options: ExtendedSendAMQPFunctionOptions =
    typeof variantOptions === "string"
      ? { url: variantOptions }
      : variantOptions;
  const routingKey =
    options["routing-key"] ??
    { direct: "cdp", fanout: "", topic: "cdp" }[
      options.exchange?.type ?? DEFAULT_EXCHANGE_TYPE
    ];
  const publishOptions = {
    ...(typeof options.expiration !== "undefined"
      ? {
          expiration:
            typeof options.expiration === "string"
              ? parseInt(options.expiration, 10)
              : options.expiration,
        }
      : {}),
    ...(typeof options.priority !== "undefined"
      ? {
          priority:
            typeof options.priority === "string"
              ? parseInt(options.priority, 10)
              : options.priority,
        }
      : {}),
    ...(typeof options.persistent !== "undefined"
      ? {
          persistent:
            typeof options.persistent === "string"
              ? options.persistent === "true"
              : options.persistent,
        }
      : {}),
  };
  const conn = await connect(options.url);
  conn.on("error", (err) => logger.error(`Error on AMQP connection: ${err}`));
  const ch = await conn.createChannel();
  ch.on("error", (err) => logger.error(`Error on AMQP channel: ${err}`));
  const { exchange } = await ch.assertExchange(
    options.exchange?.name ?? DEFAULT_EXCHANGE_NAME,
    options.exchange?.type ?? DEFAULT_EXCHANGE_TYPE,
    {
      durable:
        typeof options.exchange?.durable === "string"
          ? options.exchange?.durable === "true"
          : options.exchange?.durable ?? true,
      autoDelete:
        typeof options.exchange?.["auto-delete"] === "string"
          ? options.exchange?.["auto-delete"] === "true"
          : options.exchange?.["auto-delete"] ?? false,
    }
  );
  let passThroughChannel: Channel<Event[], never>;
  if (
    typeof options["jq-expr"] === "string" ||
    typeof options["jsonnet-expr"] === "string"
  ) {
    passThroughChannel = drain(
      await (typeof options["jq-expr"] === "string"
        ? jqProcessor.makeChannel(options["jq-expr"], {
            prelude: params["jq-prelude"],
          })
        : typeof options["jsonnet-expr"] === "string"
        ? jsonnetProcessor.makeChannel(options["jsonnet-expr"], {
            prelude: params["jsonnet-prelude"],
            stepName: params.stepName,
          })
        : Promise.reject(new Error("shouldn't happen"))),
      async (message: unknown) => {
        const flushed = ch.publish(
          exchange,
          routingKey,
          Buffer.from(
            typeof message === "string" ? message : JSON.stringify(message)
          ),
          {
            contentType:
              typeof message === "string" ? "text/plain" : "application/json",
            timestamp: Math.trunc(new Date().getTime() / 1000),
            ...publishOptions,
          }
        );
        logger.debug(
          "Published payload to AMQP exchange",
          exchange,
          "with routing key",
          routingKey
        );
        if (!flushed) {
          await new Promise((resolve) => ch.once("drain", resolve));
        }
      }
    );
  } else {
    passThroughChannel = drain(
      new AsyncQueue<Event[]>(
        `step.${params.stepName}.send-amqp.pass-through`
      ).asChannel(),
      async (events: Event[]) => {
        const flushed = ch.publish(
          exchange,
          routingKey,
          Buffer.from(events.map((e) => JSON.stringify(e)).join("\n") + "\n"),
          {
            contentType: "application/x-ndjson",
            timestamp: events
              .map((e) => Math.trunc(e.timestamp))
              .reduce((max, t) => (t > max ? t : max)),
            ...publishOptions,
          }
        );
        logger.debug(
          "Published events to AMQP exchange",
          exchange,
          "with routing key",
          routingKey
        );
        if (!flushed) {
          await new Promise((resolve) => ch.once("drain", resolve));
        }
      }
    );
  }
  const queue = new AsyncQueue<Event[]>(
    `step.${params.stepName}.send-amqp.forward`
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
      await ch.close();
      await conn.close();
    },
  };
};
