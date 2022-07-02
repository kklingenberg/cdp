import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";

/**
 * Options for this function.
 */
export type KeepFunctionOptions =
  | number
  | string
  | { first: number | string }
  | { last: number | string };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "integer", minimum: 1 },
    { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
    {
      type: "object",
      properties: {
        first: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
      },
      additionalProperties: false,
      required: ["first"],
    },
    {
      type: "object",
      properties: {
        last: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
      },
      additionalProperties: false,
      required: ["last"],
    },
  ],
};

/**
 * Validate keep options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (): void => {
  // Nothing needs to be validated.
};

/**
 * Convert a value to an integer, if it's a string.
 *
 * @param v A possibly string-typed value.
 * @returns An integer, or the number given.
 */
const toInteger = (v: number | string): number =>
  typeof v === "string" ? parseInt(v, 10) : v;

/**
 * Function that selects a fixed number of events from each batch, and
 * drops the rest.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param stepName The name of the step this function belongs to.
 * @param options The options that indicate the maximum amount of
 * events to select.
 * @returns A channel that selects events.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  stepName: string,
  options: KeepFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const quantity =
    typeof options === "string" || typeof options === "number"
      ? toInteger(options)
      : "first" in options
      ? toInteger(options.first)
      : toInteger(options.last);
  const fromStart =
    typeof options === "string" ||
    typeof options === "number" ||
    "first" in options;
  const queue = new AsyncQueue<Event[]>(`step.${stepName}.keep`);
  return flatMap(
    (events: Event[]) =>
      Promise.resolve(
        fromStart
          ? events.slice(0, quantity)
          : events.slice(Math.max(events.length - quantity, 0))
      ),
    queue.asChannel()
  );
};
