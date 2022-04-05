import fs from "fs";
import { program } from "commander";
import YAML from "yaml";
import * as pkg from "../package.json";

export const VERSION = pkg.version;

/**
 * Replace environment variable placeholders in the given thing.
 *
 * @param thing The thing to replace placeholders in.
 * @returns A replaced thing, that has the same shape as the given
 * thing but with placeholders replaced.
 */
const envsubst = (thing: unknown): unknown => thing;

/**
 * A pipeline template contains all the fields required to instantiate
 * and run a pipeline.
 */
interface PipelineTemplate {
  name: string;
  TODO: "Define this";
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
