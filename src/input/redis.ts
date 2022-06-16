import { Readable } from "stream";
import RedisClient from "ioredis";
import { Redis, Cluster } from "ioredis";
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
} from "../event";
import { makeLogger } from "../log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/redis");

/**
 * Options for this input form.
 */
export type RedisInputOptions = {
  url: string | string[];
  "address-map"?: Record<string, string>;
  subscribe?: string | string[];
  psubscribe?: string | string[];
  blpop?: string | string[];
  brpop?: string | string[];
  wrap?: WrapDirective;
};

/**
 * Build a possible schema variation, to be combined with all other
 * variations in an `anyOf`.
 *
 * @param key The variating key.
 * @returns A partial schema.
 */
const buildSchema = (key: string): object => ({
  type: "object",
  properties: {
    url: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      ],
    },
    "address-map": {
      type: "object",
      properties: {},
      additionalProperties: { type: "string", minLength: 1 },
      required: [],
    },
    [key]: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      ],
    },
    wrap: wrapDirectiveSchema,
  },
  additionalProperties: false,
  required: ["url", key],
});

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    buildSchema("subscribe"),
    buildSchema("psubscribe"),
    buildSchema("blpop"),
    buildSchema("brpop"),
  ],
};

/**
 * Default port to assume for redis connections.
 */
const DEFAULT_PORT = 6379;

/**
 * Timeout in seconds for BLPOP and BRPOP operations.
 */
const POP_TIMEOUT = 5;

/**
 * Normalize a variant argument. Useful for redis commands. Always
 * returns an array of strings.
 *
 * @param option The argument to normalize into an array of strings.
 * @returns A normalize version of the given argument.
 */
const toargs = (option: string[] | string | undefined): string[] =>
  typeof option === "undefined"
    ? []
    : Array.isArray(option)
    ? option
    : [option];

/**
 * Creates an input channel based on data coming from a redis
 * instance. Returns a pair of [channel, endPromise].
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The redis options to configure the input channel.
 * @returns A pair of a channel that connects to a redis instance or
 * cluster and produces events from SUBSCRIBE, PSUBSCRIBE, BLPOP or
 * BRPOP, and a promise indicating the channel got closed from
 * external causes.
 */
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options: RedisInputOptions
): [Channel<never, Event>, Promise<void>] => {
  const parse = chooseParser(options.wrap);
  const wrapper = makeWrapper(options.wrap);
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  let client: Redis | Cluster;
  if (
    Array.isArray(options.url) ||
    typeof options["address-map"] !== "undefined"
  ) {
    client = new Cluster(
      Array.isArray(options.url) ? options.url : [options.url],
      typeof options["address-map"] === "undefined"
        ? {}
        : {
            natMap: Object.fromEntries(
              Object.entries(options["address-map"]).map(([key, address]) => {
                // address is given as a string, and the library
                // expects a (host, port) pair
                const pair = address.split(":");
                if (pair.length === 1) {
                  return [key, { host: address, port: DEFAULT_PORT }];
                }
                const rawPort = pair[pair.length - 1];
                return [
                  key,
                  {
                    host: pair.slice(0, -1).join(":"),
                    port: parseInt(rawPort, 10),
                  },
                ];
              })
            ),
          }
    );
  } else {
    client = new RedisClient(options.url);
  }
  client.on("error", (err: Error) => logger.warn(`redis client error: ${err}`));

  const channel = flatMap(async (message: Buffer) => {
    arrivalTimestamp.update();
    const things = [];
    for await (const thing of parse(Readable.from([message]), message.length)) {
      things.push(wrapper(thing));
    }
    return things;
  }, new AsyncQueue<Buffer>().asChannel());

  // The same thing in three flavours: a stopping flag, a callback,
  // and a promise.
  let isDone = false;
  let notifyDone: () => void;
  const done = (
    new Promise((resolve) => {
      notifyDone = resolve;
    }) as Promise<void>
  ).then(() => {
    isDone = true;
  });

  // Initialize endless redis consumption
  const consuming = (async () => {
    if (typeof options.subscribe !== "undefined") {
      await client.subscribe(...toargs(options.subscribe));
      client.on("messageBuffer", (_, message: Buffer) => channel.send(message));
      await done;
    } else if (typeof options.psubscribe !== "undefined") {
      await client.psubscribe(...toargs(options.psubscribe));
      client.on("pmessageBuffer", async (_, __, message: Buffer) =>
        channel.send(message)
      );
      await done;
    } else if (typeof options.blpop !== "undefined") {
      await Promise.race([
        (async () => {
          while (!isDone) {
            const result = await client.blpopBuffer(
              toargs(options.blpop),
              POP_TIMEOUT
            );
            if (result !== null) {
              channel.send(result[1]);
            }
          }
        })(),
        done,
      ]);
    } else if (typeof options.brpop !== "undefined") {
      await Promise.race([
        (async () => {
          while (!isDone) {
            const result = await client.brpopBuffer(
              toargs(options.brpop),
              POP_TIMEOUT
            );
            if (result !== null) {
              channel.send(result[1]);
            }
          }
        })(),
        done,
      ]);
    }
  })();

  // Assemble the event channel.
  const stopConsuming: () => Promise<void> =
    typeof options.subscribe !== "undefined"
      ? async () => {
          await client.unsubscribe(...toargs(options.subscribe));
          notifyDone();
        }
      : typeof options.psubscribe !== "undefined"
      ? async () => {
          await client.punsubscribe(...toargs(options.psubscribe));
          notifyDone();
        }
      : async () => {
          notifyDone();
        };
  return [
    parseChannel(
      {
        ...channel,
        send: () => {
          logger.warn("Can't send events to an input channel");
          return false;
        },
        close: async () => {
          await stopConsuming();
          await client.quit();
          await channel.close();
          logger.debug("Drained redis input");
        },
      },
      eventParser,
      "parsing redis message"
    ),
    consuming,
  ];
};
