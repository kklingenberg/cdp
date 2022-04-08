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
