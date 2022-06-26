import { AsyncQueue, Channel, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { makeChannel } from "../io/jq";
import {
  connect,
  RedisConnectionOptions,
  instanceSchema,
  clusterSchema,
  RedisConnection,
} from "../io/redis";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/send-redis");

/**
 * Options for this function.
 */
export interface SendRedisFunctionOptions extends RedisConnectionOptions {
  publish?: string;
  rpush?: string;
  lpush?: string;
  ["jq-expr"]?: string;
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
      type: "string",
      minLength: 1,
    },
    "jq-expr": { type: "string", minLength: 1 },
  },
  additionalProperties: false,
  required: [baseKey, key],
});

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    buildSchema("instance", instanceSchema, "publish"),
    buildSchema("cluster", clusterSchema, "publish"),
    buildSchema("instance", instanceSchema, "rpush"),
    buildSchema("cluster", clusterSchema, "rpush"),
    buildSchema("instance", instanceSchema, "lpush"),
    buildSchema("cluster", clusterSchema, "lpush"),
  ],
};

/**
 * Validate send-redis options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (): void => {
  // Nothing needs to be validated.
};

/**
 * Sends a message to redis according to the given options.
 *
 * @param client The redis connection.
 * @param options The sending options.
 * @returns A function that will send any JSON-encodable thing to the
 * redis instance or cluster.
 */
const sendMessage =
  (client: RedisConnection, options: SendRedisFunctionOptions) =>
  async (...messages: unknown[]): Promise<void> => {
    if (typeof options.publish !== "undefined") {
      try {
        for (const message of messages) {
          await client.publish(options.publish, JSON.stringify(message));
        }
      } catch (err) {
        logger.warn(`Couldn't publish payload to redis: ${err}`);
      }
    } else if (typeof options.rpush !== "undefined") {
      try {
        await client.rpush(
          options.rpush,
          ...messages.map((message) => JSON.stringify(message))
        );
      } catch (err) {
        logger.warn(`Couldn't rpush payload to redis: ${err}`);
      }
    } else if (typeof options.lpush !== "undefined") {
      try {
        await client.lpush(
          options.lpush,
          ...messages.map((message) => JSON.stringify(message))
        );
      } catch (err) {
        logger.warn(`Couldn't lpush payload to redis: ${err}`);
      }
    } else {
      logger.error("Misconfigured send-redis step function");
    }
  };

/**
 * Function that sends events to a redis instance, and forwards the
 * same events to the rest of the pipeline unmodified.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to connect and send
 * events to the redis instance.
 * @returns A channel that forwards events to a redis instance.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: SendRedisFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const client: RedisConnection = connect(options);
  let forwarder: (events: Event[]) => void;
  let closeExternal: () => Promise<void>;
  if (typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], never> = drain(
      await makeChannel(options["jq-expr"]),
      sendMessage(client, options)
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
  } else {
    const passThroughChannel: Channel<Event[], never> = drain(
      new AsyncQueue<Event[]>("step.<?>.send-redis.pass-through").asChannel(),
      async (events: Event[]) => {
        await sendMessage(
          client,
          options
        )(...events.map((event) => event.toJSON()));
      }
    );
    forwarder = passThroughChannel.send.bind(passThroughChannel);
    closeExternal = passThroughChannel.close.bind(passThroughChannel);
  }
  const queue = new AsyncQueue<Event[]>("step.<?>.send-redis.forward");
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await closeExternal();
      await client.quit();
    },
  };
};
