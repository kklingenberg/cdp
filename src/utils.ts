import { createHash } from "crypto";
import Ajv from "ajv";
import { LOG_LEVEL } from "./conf";

/**
 * Central Ajv instance for the whole application.
 */
export const ajv = new Ajv();

/**
 * Creates a SHA-1 signature from the given arguments, which must be
 * JSON-encodable.
 *
 * @param ...args Anything that needs a signature.
 * @returns A promise yielding the generated signature.
 */
export const getSignature = (...args: unknown[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    hash.on("readable", () => {
      const data = hash.read();
      if (data) {
        resolve(data.toString("hex"));
      } else {
        reject(new Error("sha1 hash object didn't produce a digest"));
      }
    });
    hash.on("error", reject);
    args.forEach((arg) => hash.write(JSON.stringify(arg)));
    hash.end();
  });

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
  const currentLevelIndex = Math.max(levels.indexOf(LOG_LEVEL), 0);
  const prefix = new Map([
    ["debug", `DEBUG at ${ns}:`],
    ["info", `INFO  at ${ns}:`],
    ["warn", `WARN  at ${ns}:`],
    ["error", `ERROR at ${ns}:`],
  ]);
  return {
    ...nullLogger,
    ...Object.fromEntries(
      levels
        .slice(currentLevelIndex)
        .map((level) => [
          level,
          (...args: unknown[]) => console.error(prefix.get(level), ...args),
        ])
    ),
  };
};
