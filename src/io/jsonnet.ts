import { Processor, ProcessorOptions } from "./json-processor";

/**
 * Options used to alter a Jsonnet channel's behaviour.
 */
interface JsonnetOptions extends ProcessorOptions {
  prelude?: string;
  stepName?: string;
}

/**
 * Builds a Jsonnet snippet from code and a possible prelude.
 */
const assembleJsonnetCode = (code: string, prelude?: string): string =>
  `${prelude ?? ""}\n${code}`;

/**
 * The main access point for Jsonnet interaction.
 */
export const processor = new Processor<JsonnetOptions>(
  "stream-jsonnet",
  (code, options) => [
    options?.stepName ?? "<?>",
    "events",
    assembleJsonnetCode(code, options?.prelude),
  ]
);
