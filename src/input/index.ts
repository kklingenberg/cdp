/**
 * Parameters given to each input form initializer.
 */
export interface PipelineInputParameters {
  pipelineName: string;
  pipelineSignature: string;
  "jq-prelude"?: string;
}
