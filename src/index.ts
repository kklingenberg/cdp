import fs from "fs";
import { program } from "commander";
import YAML from "yaml";
import * as pkg from "../package.json";
import { Pattern } from "./pattern";

export const VERSION = pkg.version;

/**
 * Replace environment variable placeholders in the given thing.
 *
 * @param thing The thing to replace placeholders in.
 * @returns A replaced thing, that has the same shape as the given
 * thing but with placeholders replaced.
 */
const envsubst = (thing: unknown): unknown => {
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
 * A `rename` function changes the name of the events it receives.
 */
interface RenameFunctionTemplate {
  rename: { append?: string; prepend?: string } | { replace: string };
}

/**
 * A `deduplicate` function removes event duplicates from the batches
 * it receives.
 */
interface DeduplicateFunctionTemplate {
  deduplicate: Record<string, never>;
}

/**
 * A `keep` function limits event batches to a specific size, after
 * windowing.
 */
interface KeepFunctionTemplate {
  keep: number;
}

/**
 * A `keep-when` function removes events that don't comply with a
 * specific jsonschema.
 */
interface KeepWhenFunctionTemplate {
  ["keep-when"]: object;
}

/**
 * A `send-stdout` function emits events as serialized JSON to STDOUT,
 * and forwards the received events as-is to the rest of the pipeline.
 */
interface SendSTDOUTFunctionTemplate {
  ["send-stdout"]: {
    ["jq-expr"]?: string;
  };
}

/**
 * A `send-http` function emits event batches to a remote HTTP
 * endpoint, ignores the response entirely and forwards the original
 * events to the rest of the pipeline.
 */
interface SendHTTPFunctionTemplate {
  ["send-http"]:
    | string
    | {
        target: string;
        ["jq-expr"]?: string;
        headers?: object;
      };
}

/**
 * A `send-receive-jq` function processes batches of events with a jq
 * program, and the transformed events are sent back to the rest of
 * the pipeline.
 */
interface SendReceiveJqFunctionTemplate {
  ["send-receive-jq"]:
    | string
    | {
        ["jq-expr"]: string;
      };
}

/**
 * A `send-receive-http` function processes batches of events with a
 * remote HTTP service. The service is expected to respond with the
 * transformed events, which get forwarded to the rest of the
 * pipeline.
 */
interface SendReceiveHTTPFunctionTemplate {
  ["send-receive-http"]:
    | string
    | {
        target: string;
        ["jq-expr"]?: string;
        headers?: object;
      };
}

/**
 * A pipeline template contains all the fields required to instantiate
 * and run a pipeline.
 */
interface PipelineTemplate {
  name: string;
  input:
    | { stdin: Record<string, never> }
    | { http: { endpoint: string; port: number; ["health-endpoint"]: string } };
  steps: {
    [key: string]: {
      after?: string[];
      ["match/drop"]?: Pattern;
      ["match/pass"]?: Pattern;
      window?: {
        events: number;
        seconds: number;
      };
      flatmap?:
        | RenameFunctionTemplate
        | DeduplicateFunctionTemplate
        | KeepFunctionTemplate
        | KeepWhenFunctionTemplate
        | SendSTDOUTFunctionTemplate
        | SendHTTPFunctionTemplate
        | SendReceiveJqFunctionTemplate
        | SendReceiveHTTPFunctionTemplate;
      reduce?:
        | RenameFunctionTemplate
        | DeduplicateFunctionTemplate
        | KeepFunctionTemplate
        | KeepWhenFunctionTemplate
        | SendSTDOUTFunctionTemplate
        | SendHTTPFunctionTemplate
        | SendReceiveJqFunctionTemplate
        | SendReceiveHTTPFunctionTemplate;
    };
  };
}

/**
 * Parses and creates a pipeline template from a raw structure. Throws
 * an error with an explanation message in case the given structure
 * can't be translated into a pipeline template.
 *
 * @param thing The raw structure that should map onto a pipeline
 * template.
 * @returns The freshly created pipeline template.
 */
export const makePipelineTemplate = (thing: unknown): PipelineTemplate => {
  throw new Error("TODO not implemented");
};

/**
 * Instantiates and runs a pipeline.
 *
 * @param template The pipeline template that describes the pipeline.
 * @returns A promise that resolves to a pair: the first element is a
 * promise (another one) that resolves once the pipeline stops
 * processing; the second element is a thunk that schedules the
 * resolution of the previous promise, including the appropriate
 * cleanups.
 */
export const runPipeline = async (
  template: PipelineTemplate
): Promise<[Promise<void>, () => void]> => {
  throw new Error("TODO not implemented");
};

if (require.main === module) {
  program
    .name("cdp")
    .description(
      "Start a Composable Data Pipelines program using PIPELINEFILE as specification."
    )
    .version(pkg.version)
    .usage("[OPTION]... PIPELINEFILE")
    .option(
      "-e, --environment",
      "replace environment variables in an envsubst-like fashion in PIPELINEFILE " +
        "after YAML parsing but before pipeline checks"
    )
    .option(
      "-t, --test",
      "don't start a program, but instead simply check PIPELINEFILE for correctness"
    )
    .argument("<pipelinefile>")
    .addHelpText(
      "after",
      "\nConfiguration of cdp programs is further achieved through " +
        "environment variables.\nCheck the full documentation at: " +
        `<${pkg.homepage}>`
    )
    .action(async (pipelinefile, options) => {
      const rawPipeline = YAML.parse(fs.readFileSync(pipelinefile, "utf-8"));
      const subbedPipeline = options.environment
        ? envsubst(rawPipeline)
        : rawPipeline;
      const template = makePipelineTemplate(subbedPipeline);
      if (!options.test) {
        try {
          const [promise, finish] = await runPipeline(template);
          ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) =>
            process.on(signal, finish)
          );
          await promise;
        } catch (err) {
          process.exitCode = 1;
        }
      }
    })
    .parse();
}
