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
 * Queue draining grace period: the maximum amount of time to wait for
 * external processing to finish doing what it needs to. Measured in
 * seconds.
 */
export const QUEUE_DRAIN_GRACE_PERIOD: number = parseFloat(
  process.env.QUEUE_DRAIN_GRACE_PERIOD ?? "0.01"
);
