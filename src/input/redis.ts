import { Readable } from "stream";
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
import {
  connect,
  RedisConnectionOptions,
  instanceSchema,
  clusterSchema,
  RedisConnection,
} from "../io/redis";
import { makeLogger } from "../log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/redis");

/**
 * Options for this input form.
 */
export interface RedisInputOptions extends RedisConnectionOptions {
  subscribe?: string | string[];
  psubscribe?: string | string[];
  blpop?: string | string[];
  brpop?: string | string[];
  wrap?: WrapDirective;
}

/**
 * Build a possible schema variation, to be combined with all other
 * variations in an `anyOf`.
 *
 * @param key The variating key.
 * @returns A partial schema.
 */
const buildSchema = (
  baseKey: string,
  baseSchema: object,
  key: string
): object => ({
  type: "object",
  properties: {
    [baseKey]: baseSchema,
    [key]: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      ],
    },
    wrap: wrapDirectiveSchema,
  },
  additionalProperties: false,
  required: [baseKey, key],
});

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    buildSchema("instance", instanceSchema, "subscribe"),
    buildSchema("cluster", clusterSchema, "subscribe"),
    buildSchema("instance", instanceSchema, "psubscribe"),
    buildSchema("cluster", clusterSchema, "psubscribe"),
    buildSchema("instance", instanceSchema, "blpop"),
    buildSchema("cluster", clusterSchema, "blpop"),
    buildSchema("instance", instanceSchema, "brpop"),
    buildSchema("cluster", clusterSchema, "brpop"),
  ],
};

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
  const client: RedisConnection = connect(options);

  const channel = flatMap(async (message: string) => {
    arrivalTimestamp.update();
    const things = [];
    for await (const thing of parse(Readable.from([message]))) {
      things.push(wrapper(thing));
    }
    return things;
  }, new AsyncQueue<string>("input.redis").asChannel());

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
      try {
        client.on("message", (redisChannel: string, message: string) => {
          logger.debug("Got message from redis channel", redisChannel, message);
          channel.send(message);
        });
        await client.subscribe(...toargs(options.subscribe));
        await done;
      } catch (err) {
        logger.error(`Couldn't subscribe to channel(s): ${err}`);
      } finally {
        await client.unsubscribe(...toargs(options.subscribe));
        await client.quit();
      }
    } else if (typeof options.psubscribe !== "undefined") {
      try {
        client.on("pmessage", (_, redisChannel: string, message: string) => {
          logger.debug("Got message from redis channel", redisChannel, message);
          channel.send(message);
        });
        await client.psubscribe(...toargs(options.psubscribe));
        await done;
      } catch (err) {
        logger.error(`Couldn't psubscribe to channel pattern(s): ${err}`);
      } finally {
        await client.punsubscribe(...toargs(options.psubscribe));
        await client.quit();
      }
    } else if (typeof options.blpop !== "undefined") {
      try {
        await Promise.race([
          (async () => {
            while (!isDone) {
              const result = await client.blpop(
                toargs(options.blpop),
                POP_TIMEOUT
              );
              if (result !== null) {
                logger.debug(
                  "Got message from redis list",
                  result[0],
                  result[1]
                );
                channel.send(result[1]);
              }
            }
          })(),
          done,
        ]);
      } catch (err) {
        logger.error(`Couldn't blpop from key(s): ${err}`);
      } finally {
        await client.quit();
      }
    } else if (typeof options.brpop !== "undefined") {
      try {
        await Promise.race([
          (async () => {
            while (!isDone) {
              const result = await client.brpop(
                toargs(options.brpop),
                POP_TIMEOUT
              );
              if (result !== null) {
                logger.debug(
                  "Got message from redis list",
                  result[0],
                  result[1]
                );
                channel.send(result[1]);
              }
            }
          })(),
          done,
        ]);
      } catch (err) {
        logger.error(`Couldn't brpop from key(s): ${err}`);
      } finally {
        await client.quit();
      }
    }
  })();

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
          notifyDone();
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
