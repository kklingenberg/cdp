import RedisClient from "ioredis";
import {
  Redis,
  Cluster,
  RedisOptions,
  ClusterNode,
  ClusterOptions,
} from "ioredis";
import { makeLogger } from "../log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("io/redis");

/**
 * Redis connection options.
 */
export interface RedisConnectionOptions {
  instance?:
    | string
    | {
        path: string;
        options?: RedisOptions;
      };
  cluster?:
    | ClusterNode[]
    | {
        nodes: ClusterNode[];
        options?: ClusterOptions;
      };
}

/**
 * Ajv schema for the instance portion of the RedisOptions interface.
 */
export const instanceSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
        },
        options: { type: "object" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  ],
};

/**
 * An ajv schema for the ClusterNode[] type.
 */
const clusterNodesSchema = {
  type: "array",
  minItems: 1,
  items: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "integer", minimum: 1, maximum: 65535 },
      {
        type: "object",
        properties: {
          host: { type: "string", minLength: 1 },
          port: { type: "integer", minimum: 1, maximum: 65535 },
        },
        required: ["host", "port"],
        additionalProperties: false,
      },
    ],
  },
};

/**
 * Ajv schema for the cluster portion of the RedisOptions interface.
 */
export const clusterSchema = {
  anyOf: [
    clusterNodesSchema,
    {
      type: "object",
      properties: {
        nodes: clusterNodesSchema,
        options: { type: "object" },
      },
      required: ["nodes"],
      additionalProperties: false,
    },
  ],
};

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
export const connect = (options: RedisConnectionOptions): RedisConnection => {
  let client: RedisConnection;
  if (typeof options.cluster !== "undefined") {
    if (Array.isArray(options.cluster)) {
      client = new Cluster(options.cluster);
    } else if (typeof options.cluster.options !== "undefined") {
      client = new Cluster(options.cluster.nodes, options.cluster.options);
    } else {
      client = new Cluster(options.cluster.nodes);
    }
  } else if (typeof options.instance !== "undefined") {
    if (typeof options.instance === "string") {
      client = new RedisClient(options.instance);
    } else if (typeof options.instance.options !== "undefined") {
      client = new RedisClient(options.instance.path, options.instance.options);
    } else {
      client = new RedisClient(options.instance.path);
    }
  } else {
    throw new Error("misconfigured redis connection");
  }
  client.on("error", (err: Error) => logger.warn(`redis client error: ${err}`));
  return client;
};
