import { connect } from "amqplib";
import { Readable } from "stream";
import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap } from "../async-queue";
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
import { check, resolveAfter, makeFuse } from "../utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/amqp");

/**
 * Options for this input form.
 */
export interface AMQPInputOptions {
  url: string;
  exchange: {
    name: string;
    type: "direct" | "fanout" | "topic";
    durable?: boolean | "true" | "false";
    "auto-delete"?: boolean | "true" | "false";
  };
  "binding-pattern"?: string;
  queue?: {
    name?: string;
    durable?: boolean | "true" | "false";
    "auto-delete"?: boolean | "true" | "false";
    "message-ttl"?: number | string;
    expires?: number | string;
    "dead-letter-exchange"?: string;
    "max-length"?: number | string;
    "max-priority"?: number | string;
  };
  wrap?: WrapDirective;
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
    "binding-pattern": { type: "string" },
    queue: {
      type: "object",
      properties: {
        name: { type: "string" },
        durable: { anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }] },
        "auto-delete": {
          anyOf: [{ type: "boolean" }, { enum: ["true", "false"] }],
        },
        "message-ttl": {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 4294967295 },
            { type: "string", pattern: "^[0-9]+$" },
          ],
        },
        expires: {
          anyOf: [
            { type: "integer", minimum: 1, maximum: 4294967295 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
        "dead-letter-exchange": { type: "string", minLength: 1 },
        "max-length": {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
        "max-priority": {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 255 },
            { type: "string", pattern: "^[0-9]+$" },
          ],
        },
      },
      additionalProperties: false,
      required: [],
    },
    wrap: wrapDirectiveSchema,
  },
  additionalProperties: false,
  required: ["url", "exchange"],
};

/**
 * Validate amqp input options, after they've been checked by the ajv
 * schema.
 *
 * @param options The options to validate.
 */
export const validate = (options: AMQPInputOptions): void => {
  const matchOptions = match(options);
  check(
    matchOptions.with(
      { queue: { "message-ttl": P.select(P.string) } },
      (seconds) => ((n) => n >= 0 && n <= 4294967295)(parseInt(seconds, 10))
    ),
    "the input has an invalid value for amqp.queue.message-ttl (must be >= 0 and < 2^32)"
  );
  check(
    matchOptions.with({ queue: { expires: P.select(P.string) } }, (seconds) =>
      ((n) => n >= 1 && n <= 4294967295)(parseInt(seconds, 10))
    ),
    "the input has an invalid value for amqp.queue.expires (must be > 0 and < 2^32)"
  );
  check(
    matchOptions.with(
      { queue: { "max-priority": P.select(P.string) } },
      (priority) => ((n) => n >= 0 && n <= 255)(parseInt(priority, 10))
    ),
    "the input has an invalid value for amqp.queue.max-priority (must be >= 0 and < 256)"
  );
  check(
    matchOptions.with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
};

/**
 * Milliseconds to wait after a channel.recover().
 */
const MESSAGE_RECOVERY_INTERVAL = 5000;

/**
 * Creates an input channel based on data received from an AMQP
 * broker, dispatched to a queue bound to a channel.
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The AMQP connection options to configure the input
 * channel.
 * @returns A channel that receives data from an AMQP broker and
 * forwards parsed events, and a promise that resolves when the input
 * ends for any reason.
 */
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options: AMQPInputOptions
): [Channel<never, Event>, Promise<void>] => {
  const parse = chooseParser(options.wrap);
  const wrapper = makeWrapper(options.wrap);
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);

  const channel = flatMap(async (message: string) => {
    arrivalTimestamp.update();
    const things = [];
    for await (const thing of parse(Readable.from([message]))) {
      things.push(wrapper(thing));
    }
    return things;
  }, new AsyncQueue<string>("input.amqp").asChannel());
  const done = makeFuse();

  // Initialize endless amqp consumption
  const consuming = (async () => {
    const conn = await connect(options.url);
    conn.on("close", () => done.trigger());
    conn.on("error", () => done.trigger());
    try {
      const ch = await conn.createChannel();
      ch.on("close", () => done.trigger());
      ch.on("error", () => done.trigger());
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
      const { queue } = await ch.assertQueue(options.queue?.name ?? "", {
        durable:
          typeof options.queue?.durable === "string"
            ? options.queue?.durable === "true"
            : options.queue?.durable ?? true,
        autoDelete:
          typeof options.queue?.["auto-delete"] === "string"
            ? options.queue?.["auto-delete"] === "true"
            : options.queue?.["auto-delete"] ?? false,
        ...(typeof options.queue?.["message-ttl"] !== "undefined"
          ? {
              messageTtl:
                typeof options.queue?.["message-ttl"] === "string"
                  ? parseInt(options.queue?.["message-ttl"], 10)
                  : options.queue?.["message-ttl"],
            }
          : {}),
        ...(typeof options.queue?.expires !== "undefined"
          ? {
              expires:
                typeof options.queue?.expires === "string"
                  ? parseInt(options.queue?.expires, 10)
                  : options.queue?.expires,
            }
          : {}),
        ...(typeof options.queue?.["dead-letter-exchange"] !== "undefined"
          ? { deadLetterExchange: options.queue?.["dead-letter-exchange"] }
          : {}),
        ...(typeof options.queue?.["max-length"] !== "undefined"
          ? {
              maxLength:
                typeof options.queue?.["max-length"] === "string"
                  ? parseInt(options.queue?.["max-length"], 10)
                  : options.queue?.["max-length"],
            }
          : {}),
        ...(typeof options.queue?.["max-priority"] !== "undefined"
          ? {
              maxPriority:
                typeof options.queue?.["max-priority"] === "string"
                  ? parseInt(options.queue?.["max-priority"], 10)
                  : options.queue?.["max-priority"],
            }
          : {}),
      });
      await ch.bindQueue(
        queue,
        exchange,
        options["binding-pattern"] ??
          { direct: "cdp", fanout: "", topic: "#" }[options.exchange.type]
      );

      let scheduleRecovery = false;
      const { consumerTag } = await ch.consume(queue, (message) => {
        if (message === null) {
          return;
        }
        if (!backpressure.status()) {
          logger.debug("Got message from amqp broker", message);
          channel.send(message.content.toString());
          ch.ack(message);
        } else {
          scheduleRecovery = true;
        }
      });
      await Promise.race([
        done.promise,
        (async () => {
          while (!done.value()) {
            if (scheduleRecovery) {
              await ch.recover();
              scheduleRecovery = false;
            }
            await resolveAfter(MESSAGE_RECOVERY_INTERVAL);
          }
        })(),
      ]);
      await ch.cancel(consumerTag);

      await ch.close();
    } finally {
      await conn.close();
    }
  })().catch((err) => {
    logger.error(`Error during AMQP consumption: ${err}`);
    done.trigger();
  });

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
          logger.debug("Drained amqp input");
        },
      },
      eventParser,
      "parsing amqp message"
    ),
    consuming,
  ];
};
