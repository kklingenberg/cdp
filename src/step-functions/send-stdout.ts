import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeChannel } from "../io/jq";
import { getSTDOUT } from "../io/stdio";

/**
 * Options for this function.
 */
export type SendSTDOUTFunctionOptions = {
  ["jq-expr"]?: string;
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
export const validate = (): void => {
  // Nothing needs to be validated.
};

/**
 * Function that sends events to STDOUT and forwards them to the
 * pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to send events to
 * STDOUT (specifically, they indicate wether to use jq as a
 * transformation step).
 * @returns A channel that forwards events to STDOUT.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: SendSTDOUTFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const stdout = getSTDOUT();
  let forwarder: (events: Event[]) => void;
  let closeExternal: () => Promise<void>;
  if (options !== null && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], never> = drain(
      await makeChannel(options["jq-expr"]),
      async (result: unknown) => {
        const flushed = stdout.write(
          (typeof result === "string" ? result : JSON.stringify(result)) + "\n"
        );
        if (!flushed) {
          await new Promise((resolve) => stdout.once("drain", resolve));
        }
      }
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
  } else {
    const passThroughChannel: Channel<Event[], never> = drain(
      new AsyncQueue<Event[]>("step.<?>.send-stdout.pass-through").asChannel(),
      async (events: Event[]) => {
        for (const event of events) {
          const flushed = stdout.write(JSON.stringify(event) + "\n");
          if (!flushed) {
            await new Promise((resolve) => stdout.once("drain", resolve));
          }
        }
      }
    );
    forwarder = passThroughChannel.send.bind(passThroughChannel);
    closeExternal = passThroughChannel.close.bind(passThroughChannel);
  }
  const queue = new AsyncQueue<Event[]>("step.<?>.send-stdout.forward");
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await closeExternal();
    },
  };
};
