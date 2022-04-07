import { Channel } from "../async-queue";
import { Event } from "../event";

/**
 * Function that renames events according to the specified options.
 *
 * @param options The options that indicate how to rename events.
 * @returns A channel that renames its events.
 */
export const make = async (
  options: { append?: string; prepend?: string } | { replace: string }
): Promise<Channel<Event[], Event>> => {
  throw new Error("TODO implement rename");
};
