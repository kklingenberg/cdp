/**
 * The execution environment.
 */
export const NODE_ENV: string = process.env.NODE_ENV ?? "production";

/**
 * The minimum log level.
 */
export const LOG_LEVEL: string = (
  process.env.LOG_LEVEL ?? (NODE_ENV === "test" ? "error" : "info")
).toLowerCase();

/**
 * The maximum size of a serialized data message, in bytes.
 */
export const PARSE_BUFFER_SIZE: number = parseInt(
  process.env.PARSE_BUFFER_SIZE ?? (NODE_ENV === "test" ? "32" : "1048576"), // 1 MiB
  10
);

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
export const INPUT_DRAIN_TIMEOUT: number = parseFloat(
  process.env.INPUT_DRAIN_TIMEOUT ?? "1" // 1 second
);

/**
 * The time to wait between each self health check. Set to 0 to
 * disable self health checks.
 */
export const HEALTH_CHECK_INTERVAL: number = parseFloat(
  process.env.HEALTH_CHECK_INTERVAL ?? "5" // 5 seconds
);

/**
 * An URI that will receive an HTTP request with dead events: events
 * that couldn't be fully processed.
 */
export const DEAD_LETTER_TARGET: string | null =
  process.env.DEAD_LETTER_TARGET ?? null;

/**
 * An HTTP method to use for the request that forwards dead events.
 */
export const DEAD_LETTER_TARGET_METHOD: "POST" | "PUT" | "PATCH" = ((m) =>
  ["POST", "PUT", "PATCH"].includes(m) ? m : "POST")(
  process.env.DEAD_LETTER_TARGET_METHOD ?? "POST"
) as "POST" | "PUT" | "PATCH";

/**
 * A mapping of HTTP headers to use when sending dead events to a
 * remote service.
 */
export const DEAD_LETTER_TARGET_HEADERS: { [key: string]: string } = JSON.parse(
  process.env.DEAD_LETTER_TARGET_HEADERS ?? "{}"
);

/**
 * The default port used for listening for HTTP requests.
 */
export const HTTP_SERVER_DEFAULT_PORT: number = parseInt(
  process.env.HTTP_SERVER_DEFAULT_PORT ?? "8000",
  10
);

/**
 * The address used to listen for HTTP requests. Default is to listen
 * on all interfaces.
 */
export const HTTP_SERVER_LISTEN_ADDRESS: string =
  process.env.HTTP_SERVER_LISTEN_ADDRESS ?? "0.0.0.0";

/**
 * The TCP backlog size for the HTTP server.
 */
export const HTTP_SERVER_LISTEN_BACKLOG: number = parseInt(
  process.env.HTTP_SERVER_LISTEN_BACKLOG ?? "511",
  10
);

/**
 * The endpoint which will expose the application's health status.
 */
export const HTTP_SERVER_HEALTH_ENDPOINT: string =
  process.env.HTTP_SERVER_HEALTH_ENDPOINT ?? "/healthz";

/**
 * The time to wait between poll requests when using the `poll` input
 * form without an explicit `poll.seconds` option set.
 */
export const POLL_INPUT_DEFAULT_INTERVAL: number = parseFloat(
  process.env.POLL_INPUT_DEFAULT_INTERVAL ?? "5" // 5 seconds
);

/**
 * The port used to expose prometheus metric.
 */
export const METRICS_EXPOSITION_PORT: number = parseInt(
  process.env.METRICS_EXPOSITION_PORT ?? "8001",
  10
);

/**
 * The endpoint which will expose prometheus metrics. Set to the empty
 * string to disable metrics exposition.
 */
export const METRICS_EXPOSITION_PATH: string =
  process.env.METRICS_EXPOSITION_PATH ?? "/metrics";

/**
 * The prefix used in prometheus metric names.
 */
export const METRICS_NAME_PREFIX: string =
  process.env.METRICS_NAME_PREFIX ?? "cdp_";

/**
 * The timeout used for emitted HTTP requests.
 */
export const HTTP_CLIENT_TIMEOUT: number = parseInt(
  process.env.HTTP_CLIENT_TIMEOUT ?? "60000",
  10
);

/**
 * The upper limit of redirects accepted when emitting HTTP requests.
 */
export const HTTP_CLIENT_MAX_REDIRECTS: number = parseInt(
  process.env.HTTP_CLIENT_MAX_REDIRECTS ?? "10",
  10
);

/**
 * The upper limit of response sizes received for HTTP requests.
 */
export const HTTP_CLIENT_MAX_CONTENT_LENGTH: number = parseInt(
  process.env.HTTP_CLIENT_MAX_CONTENT_LENGTH ?? "52428800", // 50 MiB
  10
);
