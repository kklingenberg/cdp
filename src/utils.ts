import { createHash } from "crypto";
import Ajv from "ajv";

/**
 * Central Ajv instance for the whole application.
 */
export const ajv = new Ajv();

/**
 * Compile an ajv schema into a validation function that acts as an
 * identity function that throws on validation errors.
 *
 * @param schema The ajv schema to compile.
 * @returns A validation function.
 */
export const compileThrowing = <T>(schema: object): ((value: T) => T) => {
  const validate = ajv.compile(schema);
  return (value) => {
    if (!validate(value)) {
      throw new Error(ajv.errorsText(validate.errors, { separator: "; " }));
    }
    return value;
  };
};

/**
 * Creates a SHA-1 signature from the given arguments, which must be
 * JSON-encodable.
 *
 * @param ...args Anything that needs a signature.
 * @returns A promise yielding the generated signature.
 */
export const getSignature = (...args: unknown[]): Promise<string> =>
  new Promise((resolve, reject) => {
    if (args.every((arg) => typeof arg === "undefined")) {
      reject(new Error("no valid argument was given"));
      return;
    }
    const hash = createHash("sha1");
    hash.on("readable", () => {
      const data = hash.read();
      if (data) {
        resolve(data.toString("base64url"));
      } else {
        reject(new Error("sha1 hash object didn't produce a digest"));
      }
    });
    hash.on("error", reject);
    try {
      args
        .map((arg, index) => ({ arg, index }))
        .filter(({ arg }) => typeof arg !== "undefined")
        .forEach((arg) => hash.write(JSON.stringify(arg)));
    } catch (err) {
      reject(err);
    } finally {
      hash.end();
    }
  });

/**
 * Creates a promise that resolves after the specified number of
 * milliseconds.
 *
 * @param t The number of milliseconds to wait before resolving.
 * @param v The optional value to resolve with.
 * @returns A promise that resolves after the specified time and with
 * the specified value.
 */
export const resolveAfter = <T>(t: number, v?: T): Promise<T> =>
  new Promise((resolve) => setTimeout(resolve, t, v));

/**
 * Chains two async generators together into one.
 *
 * @param g1 The first generator to be consumed.
 * @param g2 The second generator to be consumed.
 * @returns A combined async generator.
 */
export async function* chain<T>(
  g1: AsyncGenerator<T>,
  g2: AsyncGenerator<T>
): AsyncGenerator<T> {
  for await (const value of g1) {
    yield value;
  }
  for await (const value of g2) {
    yield value;
  }
}

/**
 * Replace environment variable placeholders in the given thing.
 *
 * @param thing The thing to replace placeholders in.
 * @returns A replaced thing, that has the same shape as the given
 * thing but with placeholders replaced.
 */
export const envsubst = (thing: unknown): unknown => {
  if (typeof thing === "string") {
    return thing.replace(
      /\$\{[A-Za-z]\w*\}/g,
      (expr: string) => process.env[expr.slice(2, -1)] ?? ""
    );
  } else if (Array.isArray(thing)) {
    return thing.map(envsubst);
  } else if (typeof thing === "object" && thing !== null) {
    return Object.fromEntries(
      Object.entries(thing).map(([k, v]) => [envsubst(k), envsubst(v)])
    );
  } else {
    return thing;
  }
};

/**
 * Merges HTTP headers as given, preserving the last ones in case of
 * collision. This procedure ignores capitalization in header keys,
 * and assumes that each header set given doesn't contain collisions
 * within. If they do, the keys remaining in the result are chosen
 * arbitrarily.
 *
 * @param headers The headers to merge.
 * @returns The merged headers.
 */
export const mergeHeaders = <T>(
  ...headers: Record<string, T>[]
): Record<string, T> =>
  headers.reduce(
    (merged, h) => ({
      ...merged,
      ...Object.fromEntries(
        Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])
      ),
    }),
    {}
  );
