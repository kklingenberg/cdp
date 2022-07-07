import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event, makeFrom } from "../event";
import { isValidEventName } from "../pattern";
import { check } from "../utils";
import { PipelineStepFunctionParameters } from ".";

/**
 * Options for this function.
 */
export type RenameFunctionOptions =
  | {
      append?: string;
      prepend?: string;
    }
  | { replace: string };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        append: { type: "string", minLength: 1 },
        prepend: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      required: [],
    },
    {
      type: "object",
      properties: {
        replace: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      required: ["replace"],
    },
  ],
};

/**
 * Validate rename options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: RenameFunctionOptions
): void => {
  const matchOptions = match(options);
  check(
    matchOptions.with({ replace: P.select() }, isValidEventName),
    `step '${name}' uses an invalid rename.replace value: ` +
      "it must be a proper event name"
  );
  check(
    matchOptions.with(
      { append: P.select(P.string) },
      (append) =>
        (append.startsWith(".") && isValidEventName(append.slice(1))) ||
        isValidEventName(append)
    ),
    `step '${name}' uses an invalid rename.append value: ` +
      "it must be a proper event name suffix"
  );
  check(
    matchOptions.with(
      { prepend: P.select(P.string) },
      (prepend) =>
        (prepend.endsWith(".") && isValidEventName(prepend.slice(0, -1))) ||
        isValidEventName(prepend)
    ),
    `step '${name}' uses an invalid rename.prepend value: ` +
      "it must be a proper event name prefix"
  );
};

/**
 * Function that renames events according to the specified options.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate how to rename events.
 * @returns A channel that renames its events.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: RenameFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const makeNewName: (name: string) => string =
    "replace" in options
      ? () => options.replace
      : (name) => (options.prepend ?? "") + name + (options.append ?? "");
  const queue = new AsyncQueue<Event[]>(`step.${params.stepName}.rename`);
  return flatMap(
    (events: Event[]) =>
      Promise.all(
        events.map((event) =>
          makeFrom(event, { name: makeNewName(event.name) })
        )
      ),
    queue.asChannel()
  );
};
