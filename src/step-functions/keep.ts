import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";

/**
 * Options for this function.
 */
export type KeepFunctionOptions = number | string;

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "integer", minimum: 1 },
    { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
  ],
};

/**
 * Function that selects a fixed number of events from each batch, and
 * drops the rest.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate the maximum amount of
 * events to select.
 * @returns A channel that selects events.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: KeepFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const quantity =
    typeof options === "string" ? parseInt(options, 10) : options;
  const queue = new AsyncQueue<Event[]>();
  return flatMap(
    (events: Event[]) => Promise.resolve(events.slice(0, quantity)),
    queue.asChannel()
  );
};
