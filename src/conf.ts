import { compileThrowing } from "./utils";

/**
 * Parse a value from the environment by running it through a set of
 * parsing functions.
 *
 * @param key The environment variable name.
 * @param firstFn The first function that takes the raw string in the
 * environment.
 * @param fns The rest of the functions to run the value through.
 * @returns The final validated value, or null if the variable wasn't
 * found.
 */
const fromEnv = <T>(
  key: string,
  firstFn: (value: string) => T,
  ...fns: ((value: T) => T)[]
): null | T => {
  const raw = process.env[key];
  if (typeof raw === "undefined") {
    return null;
  }
  let value: T;
  try {
    value = firstFn(raw);
  } catch (err) {
    throw new Error(
      `The configured value for the ${key} variable is not valid: ${err}`
    );
  }
  for (const fn of fns) {
    try {
      value = fn(value);
    } catch (err) {
      throw new Error(
        `The configured value for the ${key} variable is not valid: ${err}`
      );
    }
  }
  return value;
};

/**
 * The execution environment.
 */
export const NODE_ENV = (fromEnv(
  "NODE_ENV",
  (s) => s.toLowerCase(),
  compileThrowing({ enum: ["production", "development", "test"] })
) ?? "production") as "production" | "development" | "test";

/**
 * The minimum log level.
 */
export const LOG_LEVEL = (fromEnv(
  "LOG_LEVEL",
  (s) => s.toLowerCase(),
  compileThrowing({ enum: ["debug", "info", "warn", "error"] })
) ?? (NODE_ENV === "test" ? "error" : "info")) as
  | "debug"
  | "info"
  | "warn"
  | "error";

/**
 * The maximum size of a serialized data message, in bytes.
 */
export const PARSE_BUFFER_SIZE: number =
  fromEnv(
    "PARSE_BUFFER_SIZE",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 32 })
  ) ?? (NODE_ENV === "test" ? 32 : 1048576); // 32 bytes or 1 Mib

/**
 * The standard PATH variable, split on ':'.
 */
export const PATH: string[] = (process.env.PATH ?? "")
  .split(":")
  .filter((p) => p.length > 0);

/**
 * The time to wait after the input drains before closing the
 * pipeline.
 */
export const INPUT_DRAIN_TIMEOUT: number =
  fromEnv(
    "INPUT_DRAIN_TIMEOUT",
    JSON.parse,
    compileThrowing({ type: "number", exclusiveMinimum: 0 })
  ) ?? 1; // 1 second

/**
 * The time to wait between each self health check. Set to 0 to
 * disable self health checks.
 */
export const HEALTH_CHECK_INTERVAL: number =
  fromEnv(
    "HEALTH_CHECK_INTERVAL",
    JSON.parse,
    compileThrowing({ type: "number", minimum: 0 })
  ) ?? 5; // 5 seconds

/**
 * An URI that will receive an HTTP request with dead events: events
 * that couldn't be fully processed.
 */
export const DEAD_LETTER_TARGET: string | null = fromEnv(
  "DEAD_LETTER_TARGET",
  compileThrowing({ type: "string", pattern: "^https?://\\S+$" })
);

/**
 * An HTTP method to use for the request that forwards dead events.
 */
export const DEAD_LETTER_TARGET_METHOD = (fromEnv(
  "DEAD_LETTER_TARGET_METHOD",
  (s) => s.toUpperCase(),
  compileThrowing({ enum: ["POST", "PUT", "PATCH"] })
) ?? "POST") as "POST" | "PUT" | "PATCH";

/**
 * A mapping of HTTP headers to use when sending dead events to a
 * remote service.
 */
export const DEAD_LETTER_TARGET_HEADERS = (fromEnv(
  "DEAD_LETTER_TARGET_HEADERS",
  JSON.parse,
  compileThrowing({
    type: "object",
    properties: {},
    additionalProperties: {
      anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
    },
  })
) ?? {}) as {
  [key: string]: string | number | boolean;
};

/**
 * The default port used for listening for HTTP requests.
 */
export const HTTP_SERVER_DEFAULT_PORT: number =
  fromEnv(
    "HTTP_SERVER_DEFAULT_PORT",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 1, maximum: 65535 })
  ) ?? 8000;

/**
 * The address used to listen for HTTP requests. Default is to listen
 * on all interfaces.
 */
export const HTTP_SERVER_LISTEN_ADDRESS: string =
  fromEnv(
    "HTTP_SERVER_LISTEN_ADDRESS",
    compileThrowing({ type: "string", minLength: 1 })
  ) ?? "0.0.0.0";

/**
 * The TCP backlog size for the HTTP server.
 */
export const HTTP_SERVER_LISTEN_BACKLOG: number =
  fromEnv(
    "HTTP_SERVER_LISTEN_BACKLOG",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 1 })
  ) ?? 511;

/**
 * The endpoint which will expose the application's health status.
 */
export const HTTP_SERVER_HEALTH_ENDPOINT: string =
  fromEnv(
    "HTTP_SERVER_HEALTH_ENDPOINT",
    compileThrowing({ type: "string", pattern: "^/\\S*$" })
  ) ?? "/healthz";

/**
 * The time to wait between poll requests when using the `poll` input
 * form without an explicit `poll.seconds` option set.
 */
export const POLL_INPUT_DEFAULT_INTERVAL: number =
  fromEnv(
    "POLL_INPUT_DEFAULT_INTERVAL",
    JSON.parse,
    compileThrowing({ type: "number", exclusiveMinimum: 0 })
  ) ?? 5; // 5 seconds

/**
 * The port used to expose prometheus metric.
 */
export const METRICS_EXPOSITION_PORT: number =
  fromEnv(
    "METRICS_EXPOSITION_PORT",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 1, maximum: 65535 })
  ) ?? 8001;

/**
 * The endpoint which will expose prometheus metrics. Set to the empty
 * string to disable metrics exposition.
 */
export const METRICS_EXPOSITION_PATH: string =
  fromEnv(
    "METRICS_EXPOSITION_PATH",
    compileThrowing({ type: "string", pattern: "^(/\\S*)?$" })
  ) ?? "/metrics";

/**
 * The prefix used in prometheus metric names.
 */
export const METRICS_NAME_PREFIX: string =
  fromEnv(
    "METRICS_NAME_PREFIX",
    compileThrowing({ type: "string", pattern: "[A-Za-z]\\w*" })
  ) ?? "cdp_";

/**
 * The timeout used for emitted HTTP requests.
 */
export const HTTP_CLIENT_TIMEOUT: number =
  fromEnv(
    "HTTP_CLIENT_TIMEOUT",
    JSON.parse,
    compileThrowing({ type: "number", exclusiveMinimum: 0 })
  ) ?? 60; // 60 seconds

/**
 * Whether to reject invalid TLS certificates. Defaults to `true`.
 */
export const HTTP_CLIENT_REJECT_UNAUTHORIZED = !["false", "no", "0"].includes(
  (process.env.HTTP_CLIENT_REJECT_UNAUTHORIZED ?? "yes").toLowerCase()
);

/**
 * The upper limit of redirects accepted when emitting HTTP requests.
 */
export const HTTP_CLIENT_MAX_REDIRECTS: number =
  fromEnv(
    "HTTP_CLIENT_MAX_REDIRECTS",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 0 })
  ) ?? 10;

/**
 * The upper limit of response sizes received for HTTP requests.
 */
export const HTTP_CLIENT_MAX_CONTENT_LENGTH: number =
  fromEnv(
    "HTTP_CLIENT_MAX_CONTENT_LENGTH",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 32 })
  ) ?? 52428800; // 50 MiB

/**
 * The maximum number of additional request attempts for each HTTP
 * response received with status 5xx.
 */
export const HTTP_CLIENT_MAX_RETRIES: number =
  fromEnv(
    "HTTP_CLIENT_MAX_RETRIES",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 0 })
  ) ?? 4;

/**
 * The constant factor used in HTTP requests exponential backoff, in
 * seconds.
 */
export const HTTP_CLIENT_BACKOFF_FACTOR: number =
  fromEnv(
    "HTTP_CLIENT_BACKOFF_FACTOR",
    JSON.parse,
    compileThrowing({ type: "number", minimum: 0 })
  ) ?? (NODE_ENV === "test" ? 0 : 1); // 0 or 1 second

/**
 * The maximum amount of concurrent HTTP requests to execute in a
 * forwarding step function.
 */
export const HTTP_CLIENT_DEFAULT_CONCURRENCY: number =
  fromEnv(
    "HTTP_CLIENT_DEFAULT_CONCURRENCY",
    JSON.parse,
    compileThrowing({ type: "integer", minimum: 1 })
  ) ?? 10;
