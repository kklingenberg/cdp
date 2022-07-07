import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event, arrivalTimestamp, makeNewEventParser } from "../event";
import { makeLogger } from "../log";
import { backpressure } from "../metrics";
import { isValidEventName } from "../pattern";
import { check } from "../utils";
import { PipelineInputParameters } from ".";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/generator");

/**
 * Options for this input form.
 */
export type GeneratorInputOptions =
  | { name?: string; seconds?: number | string }
  | string
  | null;

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        seconds: {
          anyOf: [
            { type: "number", exclusiveMinimum: 0 },
            { type: "string", pattern: "^[0-9]+\\.?[0-9]*$" },
          ],
        },
      },
      additionalProperties: false,
      required: [],
    },
    { type: "string", minLength: 1 },
    { type: "null" },
  ],
};

/**
 * Validate generator input options, after they've been checked by the
 * ajv schema.
 *
 * @param options The options to validate.
 */
export const validate = (options: GeneratorInputOptions): void => {
  const matchOptions = match(options);
  check(
    matchOptions
      .with(P.select(P.string), isValidEventName)
      .with({ name: P.select(P.string) }, isValidEventName),
    "the input has an invalid value for generator.name: " +
      "it must be a proper event name"
  );
  check(
    matchOptions.with(
      { seconds: P.select(P.string) },
      (seconds) => parseFloat(seconds) > 0
    ),
    "the input has an invalid value for generator.seconds (must be > 0)"
  );
};

/**
 * Creates an input channel that produces events at a fixed rate. It
 * is mainly intended to help with testing pipelines.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The generator options to configure the channel.
 * @returns A channel that produces events at a fixed rate, and a
 * promise that never resolves by itself.
 */
export const make = (
  params: PipelineInputParameters,
  options: GeneratorInputOptions
): [Channel<never, Event>, Promise<void>] => {
  const eventParser = makeNewEventParser(
    params.pipelineName,
    params.pipelineSignature
  );
  const n =
    options === null
      ? "_"
      : typeof options === "string"
      ? options
      : options.name ?? "_";
  const durationSeconds =
    options === null
      ? 1
      : typeof options === "string"
      ? 1
      : typeof options.seconds === "string"
      ? parseFloat(options.seconds)
      : options.seconds ?? 1;
  const intervalDuration = durationSeconds * 1000;
  const queue = new AsyncQueue<number>("input.generator");
  const interval = setInterval(() => {
    if (!backpressure.status()) {
      queue.push(Math.random());
    }
  }, intervalDuration);
  const channel = flatMap(async (d) => {
    arrivalTimestamp.update();
    const event = await eventParser({ n, d });
    return [event];
  }, queue.asChannel());
  return [
    {
      ...channel,
      send: () => {
        logger.warn("Can't send events to an input channel");
        return false;
      },
      close: async () => {
        clearInterval(interval);
        await channel.close();
      },
    },
    queue.drain,
  ];
};
