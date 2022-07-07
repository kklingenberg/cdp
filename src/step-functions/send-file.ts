import { appendFile as appendFileCallback } from "fs";
import { promisify } from "util";
import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { check } from "../utils";
import { PipelineStepFunctionParameters, makeProcessorChannel } from ".";

/**
 * Use fs.appendFile as an async function.
 */
const appendFile: (path: string, data: string) => Promise<void> =
  promisify(appendFileCallback);

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/send-file");

/**
 * Options for this function.
 */
export type SendFileFunctionOptions =
  | string
  | {
      path: string;
      "jq-expr"?: string;
      "jsonnet-expr"?: string;
    };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        "jq-expr": { type: "string", minLength: 1 },
        "jsonnet-expr": { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      required: ["path"],
    },
  ],
};

/**
 * Validate send-file options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendFileFunctionOptions
): void => {
  check(
    match(options).with(
      { "jq-expr": P.string, "jsonnet-expr": P.string },
      () => false
    ),
    `step '${name}' can't use both jq and jsonnet expressions simultaneously`
  );
};

/**
 * Function that appends events to a file and forwards them to the
 * pipeline.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate how to append events to a
 * file.
 * @returns A channel that appends events to a file.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: SendFileFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const path = typeof options === "string" ? options : options.path;
  let passThroughChannel: Channel<Event[], never>;
  if (
    typeof options === "object" &&
    (typeof options["jq-expr"] === "string" ||
      typeof options["jsonnet-expr"] === "string")
  ) {
    passThroughChannel = drain(
      await makeProcessorChannel(params, options),
      async (result: unknown) => {
        try {
          await appendFile(
            path,
            (typeof result === "string" ? result : JSON.stringify(result)) +
              "\n"
          );
        } catch (err) {
          logger.error(`Couldn't append to file ${path}: ${err}`);
        }
      }
    );
  } else {
    passThroughChannel = drain(
      new AsyncQueue<Event[]>(
        `step.${params.stepName}.send-file.accumulating`
      ).asChannel(),
      async (events: Event[]) => {
        const output =
          events.map((event) => JSON.stringify(event)).join("\n") + "\n";
        try {
          await appendFile(path, output);
        } catch (err) {
          logger.error(`Couldn't append to file ${path}: ${err}`);
        }
      }
    );
  }
  const queue = new AsyncQueue<Event[]>(
    `step.${params.stepName}.send-file.forward`
  );
  const forwardingChannel = flatMap(async (events: Event[]) => {
    passThroughChannel.send(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await passThroughChannel.close();
    },
  };
};
