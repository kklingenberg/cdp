import { Channel } from "../async-queue";
import { Event } from "../event";

/**
 * Function that removes event duplicates in each batch.
 *
 * @param options The options that indicate how to deduplicate
 * events. This argument is actually ignored, since currently there
 * are no options available.
 * @returns A channel that removes event duplicates.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  options: Record<string, never> | null
  /* eslint-enable @typescript-eslint/no-unused-vars */
): Promise<Channel<Event[], Event>> => {
  throw new Error("TODO implement deduplicate");
};
