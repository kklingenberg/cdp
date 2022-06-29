import { LOG_LEVEL } from "./conf";

/**
 * The shape of a logger.
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * The base do-nothing logger.
 */
const nullLogger: Logger = {
  debug: () => null,
  info: () => null,
  warn: () => null,
  error: () => null,
};

/**
 * Creates a simple logger with the specified namespace, which emits
 * messages with a namespace-specific prefix.
 *
 * @param ns The logger's namespace.
 * @returns The logger instance.
 */
export const makeLogger = (ns: string): Logger => {
  const levels = ["debug", "info", "warn", "error"];
  if (!levels.includes(LOG_LEVEL)) {
    return nullLogger;
  }
  const currentLevelIndex = levels.indexOf(LOG_LEVEL);
  const prefix = new Map([
    ["debug", `DEBUG at ${ns}:`],
    ["info", `INFO  at ${ns}:`],
    ["warn", `WARN  at ${ns}:`],
    ["error", `ERROR at ${ns}:`],
  ]);
  return {
    ...nullLogger,
    ...Object.fromEntries(
      levels.slice(currentLevelIndex).map((level) => [
        level,
        (
          (p) =>
          (...args: unknown[]) =>
            console.error(p, ...args)
        )(prefix.get(level)),
      ])
    ),
  };
};
