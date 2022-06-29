import { connect } from "amqplib";
import { match, P } from "ts-pattern";
import { AsyncQueue, Channel, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { check } from "../utils";
import { makeChannel } from "../io/jq";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/send-amqp");

/**
 * Options for this function.
 */
export interface SendAMQPFunctionOptions {
  url: string;
  exchange: {
    name: string;
    type: "direct" | "fanout" | "topic";
    durable?: boolean | "true" | "false";
    "auto-delete"?: boolean | "true" | "false";
  };
  "routing-key"?: string;
  expiration?: number | string;
  priority?: number | string;
  persistent?: boolean | "true" | "false";
  "jq-expr"?: string;
}

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
};

/**
 * Function that sends events to an AMQP broker, and forwards the same
 * events to the rest of the pipeline unmodified.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to connect and send
 * events to the AMQP broker.
 * @returns A channel that forwards events to an AMQP broker.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: SendAMQPFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const routingKey =
    options["routing-key"] ??
    { direct: "cdp", fanout: "", topic: "cdp" }[options.exchange.type];
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
    options.exchange.name,
    options.exchange.type,
    {
      durable:
        typeof options.exchange.durable === "string"
          ? options.exchange.durable === "true"
          : options.exchange.durable ?? true,
      autoDelete:
        typeof options.exchange["auto-delete"] === "string"
          ? options.exchange["auto-delete"] === "true"
          : options.exchange["auto-delete"] ?? false,
    }
  );
  let forwarder: (events: Event[]) => void;
  let closeExternal: () => Promise<void>;
  if (typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], never> = drain(
      await makeChannel(options["jq-expr"]),
      async (message: unknown) => {
        const flushed = ch.publish(
          exchange,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            contentType: "application/json",
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
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
  } else {
    const passThroughChannel: Channel<Event[], never> = drain(
      new AsyncQueue<Event[]>("step.<?>.send-redis.pass-through").asChannel(),
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
    forwarder = passThroughChannel.send.bind(passThroughChannel);
    closeExternal = passThroughChannel.close.bind(passThroughChannel);
  }
  const queue = new AsyncQueue<Event[]>("step.<?>.send-amqp.forward");
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await closeExternal();
      await ch.close();
      await conn.close();
    },
  };
};