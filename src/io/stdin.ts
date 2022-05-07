import { Readable } from "stream";

/**
 * Wrap process.stdin into a getter to provide mocking options.
 */
export const getSTDIN = (): Readable => process.stdin;
