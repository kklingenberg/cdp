import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";
import { sendReceiveEvents, sendReceiveThing } from "../io/http-client";
import { makeChannel } from "../io/jq";

/**
 * Function that sends events to a remote HTTP endpoint, parses the
 * response and interprets it as transformed events, and forwards
 * those events to the pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that uses a remote HTTP endpoint to transform
 * events.
 */
export const make = async (
  pipelineName: string,
  pipelineSignature: string,
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
  if (typeof options !== "string" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], unknown> = await makeChannel(
      options["jq-expr"]
    );
    return flatMap(
      (thing: unknown) =>
        sendReceiveThing(
          thing,
          pipelineName,
          pipelineSignature,
          target,
          headers
        ),
      jqChannel
    );
  } else {
    const queue = new AsyncQueue<Event[]>();
    return flatMap(
      (events: Event[]) =>
        sendReceiveEvents(
          events,
          pipelineName,
          pipelineSignature,
          target,
          headers
        ),
      queue.asChannel()
    );
  }
};
