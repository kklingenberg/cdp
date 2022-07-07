import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";
import { ajv } from "../utils";
import { PipelineStepFunctionParameters } from ".";

/**
 * Options for this function.
 */
export type KeepWhenFunctionOptions = object;

/**
 * An ajv schema for the options.
 */
export const optionsSchema = { type: "object" };

/**
 * Validate keep-when options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: KeepWhenFunctionOptions
): void => {
  if (!ajv.validateSchema(options)) {
    throw new Error(
      `step '${name}' uses an invalid schema in keep-when; ` +
        "check https://json-schema.org/understanding-json-schema/ for reference"
    );
  }
};

/**
 * Function that selects events according to a schema that is compared
 * with each event's data. Event's that don't match the schema are
 * dropped.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The schema against which the events are matched.
 * @returns A channel that selects events using a schema.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: KeepWhenFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const matchesSchema = ajv.compile(options);
  const queue = new AsyncQueue<Event[]>(`step.${params.stepName}.keep-when`);
  return flatMap(
    (events: Event[]) =>
      Promise.resolve(events.filter((event) => matchesSchema(event.data))),
    queue.asChannel()
  );
};
