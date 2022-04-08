import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";
import { sendEvents, sendThing } from "../io/http-client";
import { makeChannel } from "../io/jq";

/**
 * Function that sends events to a remote HTTP endpoint, ignores the
 * response and forwards the events to the pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that forwards events via HTTP.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options:
    | string
    | {
        target: string;
        ["jq-expr"]?: string;
        headers?: { [key: string]: string | number | boolean };
      }
): Promise<Channel<Event[], Event>> => {
  const target = typeof options === "string" ? options : options.target;
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  let forwarder: (events: Event[]) => void = (events: Event[]) =>
    sendEvents(events, target, headers);
  let closeExternal: () => Promise<void> = async () => {
    // Empty function
  };
  if (typeof options !== "string" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], unknown> = await makeChannel(
      options["jq-expr"]
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
    // Start the sending of jq to the HTTP target.
    (async () => {
      for await (const response of jqChannel.receive) {
        // Note: the response is not awaited for. This sends requests
        // in parallel for as much parallelism as is supported by the
        // runtime.
        sendThing(response, target, headers);
      }
    })();
  }
  const queue = new AsyncQueue<Event[]>();
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await closeExternal();
      await forwardingChannel.close();
    },
  };
};
