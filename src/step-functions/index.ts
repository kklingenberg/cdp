/**
 * Parameters given to each step-function initializer.
 */
export interface PipelineStepFunctionParameters {
  pipelineName: string;
  pipelineSignature: string;
  stepName: string;
  "jq-prelude"?: string;
}
