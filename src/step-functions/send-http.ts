import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { HTTP_CLIENT_DEFAULT_CONCURRENCY } from "../conf";
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
        method?: "POST" | "PUT" | "PATCH";
        ["jq-expr"]?: string;
        headers?: { [key: string]: string | number | boolean };
        concurrent?: number | string;
      }
): Promise<Channel<Event[], Event>> => {
  const target = typeof options === "string" ? options : options.target;
  const method =
    typeof options === "string" ? "POST" : options.method ?? "POST";
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  const concurrent =
    typeof options === "string"
      ? HTTP_CLIENT_DEFAULT_CONCURRENCY
      : typeof options.concurrent === "string"
      ? parseInt(options.concurrent, 10)
      : options.concurrent ?? 10;
  let forwarder: (events: Event[]) => void;
  let closeExternal: () => Promise<void>;
  if (typeof options !== "string" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], unknown> = await makeChannel(
      options["jq-expr"]
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
    // Start the sending of jq to the HTTP target.
    (async () => {
      const requests = new Array<Promise<void>>(concurrent);
      let i = 0;
      for await (const response of jqChannel.receive) {
        requests[i++] = sendThing(response, target, method, headers);
        if (i === concurrent) {
          await Promise.all(requests);
          i = 0;
        }
      }
      await Promise.all(requests.slice(0, i));
    })();
  } else {
    const accumulatingChannel = new AsyncQueue<Event[]>().asChannel();
    forwarder = accumulatingChannel.send.bind(accumulatingChannel);
    closeExternal = accumulatingChannel.close.bind(accumulatingChannel);
    // Start the sending of jq to the HTTP target.
    (async () => {
      const requests = new Array<Promise<void>>(concurrent);
      let i = 0;
      for await (const events of accumulatingChannel.receive) {
        requests[i++] = sendEvents(events, target, method, headers);
        if (i === concurrent) {
          await Promise.all(requests);
          i = 0;
        }
      }
      await Promise.all(requests.slice(0, i));
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
