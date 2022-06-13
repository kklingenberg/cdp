import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeChannel } from "../io/jq";

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
  let forwarder: (events: Event[]) => void = (events: Event[]) =>
    events.forEach((event) => console.log(JSON.stringify(event)));
  let closeExternal: () => Promise<void> = async () => {
    // Empty function
  };
  if (options !== null && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], never> = drain(
      await makeChannel(options["jq-expr"]),
      async (result: unknown) => {
        console.log(
          typeof result === "string" ? result : JSON.stringify(result)
        );
      }
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
  }
  const queue = new AsyncQueue<Event[]>();
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
