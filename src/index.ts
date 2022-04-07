import fs from "fs";
import { program } from "commander";
import YAML from "yaml";
import * as pkg from "../package.json";
import { makePipelineTemplate, runPipeline } from "./api";
import { envsubst } from "./utils";

export const VERSION = pkg.version;

if (require.main === module) {
  program
    .name("cdp")
    .description(
      "Start a Composable Data Pipelines program using PIPELINEFILE as specification."
    )
    .version(VERSION)
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
      try {
        const rawPipeline = YAML.parse(fs.readFileSync(pipelinefile, "utf-8"));
        const subbedPipeline = options.environment
          ? envsubst(rawPipeline)
          : rawPipeline;
        const template = makePipelineTemplate(subbedPipeline);
        if (!options.test) {
          const [promise, finish] = await runPipeline(template);
          ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) =>
            process.on(signal, finish)
          );
          await promise;
        } else {
          console.log("Pipeline configuration looks OK!");
        }
      } catch (err) {
        console.error(err);
        process.exitCode = 1;
      }
    })
    .parse();
}
