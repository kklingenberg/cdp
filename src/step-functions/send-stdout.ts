import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { check, makeFuse } from "../utils";
import { getSTDOUT } from "../io/stdio";
import { PipelineStepFunctionParameters, makeProcessorChannel } from ".";

/**
 * Options for this function.
 */
export type SendSTDOUTFunctionOptions = {
  "jq-expr"?: string;
  "jsonnet-expr"?: string;
} | null;

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        "jq-expr": { type: "string", minLength: 1 },
        "jsonnet-expr": { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      required: [],
    },
    { type: "null" },
  ],
};

/**
 * Validate send-redis options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendSTDOUTFunctionOptions
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
 * Function that sends events to STDOUT and forwards them to the
 * pipeline.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate how to send events to
 * STDOUT (specifically, they indicate wether to use jq as a
 * transformation step).
 * @returns A channel that forwards events to STDOUT.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: SendSTDOUTFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const stdout = getSTDOUT();
  const closed = makeFuse();
  stdout.on("close", () => closed.trigger());
  let passThroughChannel: Channel<Event[], never>;
  if (options !== null && typeof options["jq-expr"] === "string") {
    passThroughChannel = drain(
      await makeProcessorChannel(params, options),
      async (result: unknown) => {
        const flushed = stdout.write(
          (typeof result === "string" ? result : JSON.stringify(result)) + "\n"
        );
        if (!flushed && !closed.value()) {
          await closed.guard((resolve) => stdout.once("drain", resolve));
        }
      }
    );
  } else {
    passThroughChannel = drain(
      new AsyncQueue<Event[]>(
        `step.${params.stepName}.send-stdout.pass-through`
      ).asChannel(),
      async (events: Event[]) => {
        for (const event of events) {
          const flushed = stdout.write(JSON.stringify(event) + "\n");
          if (!flushed && !closed.value()) {
            await closed.guard((resolve) => stdout.once("drain", resolve));
          }
        }
      }
    );
  }
  const queue = new AsyncQueue<Event[]>(
    `step.${params.stepName}.send-stdout.forward`
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
