import { Channel } from "../async-queue";
import { processor as jqProcessor } from "../io/jq";
import { processor as jsonnetProcessor } from "../io/jsonnet";

/**
 * Parameters given to each step-function initializer.
 */
export interface PipelineStepFunctionParameters {
  pipelineName: string;
  pipelineSignature: string;
  stepName: string;
  "jq-prelude"?: string;
  "jsonnet-prelude"?: string;
}

/**
 * Options for functions that are compatible with jq or jsonnet
 * processing.
 */
interface ProcessableStepOptions {
  "jq-expr"?: string;
  "jsonnet-expr"?: string;
}

/**
 * Builds a channel for JSON processing, using one of the configured
 * processors.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate the use of one JSON
 * processor.
 * @returns A promise yielding a channel that processes JSON
 * externally.
 */
export const makeProcessorChannel = <T>(
  params: PipelineStepFunctionParameters,
  options: ProcessableStepOptions
): Promise<Channel<T, unknown>> =>
  typeof options["jq-expr"] === "string"
    ? jqProcessor.makeChannel(options["jq-expr"], {
        prelude: params["jq-prelude"],
      })
    : typeof options["jsonnet-expr"] === "string"
    ? jsonnetProcessor.makeChannel(options["jsonnet-expr"], {
        prelude: params["jsonnet-prelude"],
        stepName: params.stepName,
      })
    : Promise.reject(new Error("neither jq nor jsonnet are configured"));
