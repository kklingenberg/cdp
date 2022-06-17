import RedisClient from "ioredis";
import { Redis, Cluster } from "ioredis";
import { makeLogger } from "../log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("io/redis");

/**
 * Redis connection options.
 */
interface Options {
  url: string | string[];
  "address-map"?: Record<string, string>;
}

/**
 * Default port to assume for redis connections.
 */
const DEFAULT_PORT = 6379;

/**
 * Wrap both connection types.
 */
export type RedisConnection = Redis | Cluster;

/**
 * Create a single instance or cluster client.
 *
 * @param options The options given for the connection.
 * @returns A client object for a single instance or a cluster.
 */
export const connect = (options: Options): RedisConnection => {
  let client: RedisConnection;
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
  return client;
};
