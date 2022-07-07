import { Processor, ProcessorOptions } from "./json-processor";

/**
 * Options used to alter a jq channel's behaviour.
 */
interface JqOptions extends ProcessorOptions {
  prelude?: string;
}

/**
 * Wraps a jq expression so that execution failures don't crash the jq
 * process.
 */
const wrapJqCode = (code: string, prelude?: string): string =>
  `${prelude ?? ""}\ntry (${code})`;

/**
 * The main access point for jq interaction.
 */
export const processor = new Processor<JqOptions>("jq", (code, options) => [
  "-cM",
  "--unbuffered",
  wrapJqCode(code, options?.prelude),
]);
