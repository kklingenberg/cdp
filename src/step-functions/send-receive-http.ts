import { Channel } from "../async-queue";
import { Event } from "../event";

/**
 * Function that sends events to a remote HTTP endpoint, parses the
 * response and interprets it as transformed events, and forwards
 * those events to the pipeline.
 *
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that uses a remote HTTP endpoint to transform
 * events.
 */
export const make = async (
  options: string | { target: string; ["jq-expr"]?: string; headers?: object }
): Promise<Channel<Event[], Event>> => {
  throw new Error("TODO implement send-receive-http");
};
