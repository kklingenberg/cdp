import { Readable, Writable } from "stream";

/**
 * Wrap process.stdin into a getter to provide mocking options.
 */
export const getSTDIN = (): Readable => process.stdin;

/**
 * Wrap process.stdout into a getter to provide mocking options.
 */
export const getSTDOUT = (): Writable => process.stdout;
