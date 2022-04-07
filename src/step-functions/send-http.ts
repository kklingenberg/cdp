import { Channel } from "../async-queue";
import { Event } from "../event";

/**
 * Function that sends events to a remote HTTP endpoint, ignores the
 * response and forwards the events to the pipeline.
 *
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that forwards events via HTTP.
 */
export const make = async (
  options: string | { target: string; ["jq-expr"]?: string; headers?: object }
): Promise<Channel<Event[], Event>> => {
  throw new Error("TODO implement send-http");
};
