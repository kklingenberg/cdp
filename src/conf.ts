/**
 * The minimum log level.
 */
export const LOG_LEVEL: string = (
  process.env.LOG_LEVEL ?? "info"
).toLowerCase();
