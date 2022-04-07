import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";

/**
 * Function that selects a fixed number of events from each batch, and
 * drops the rest.
 *
 * @param options The options that indicate the maximum amount of
 * events to select.
 * @returns A channel that selects events.
 */
export const make = async (
  options: number | string
): Promise<Channel<Event[], Event>> => {
  const quantity =
    typeof options === "string" ? parseInt(options, 10) : options;
  const queue = new AsyncQueue<Event[]>();
  return flatMap(
    (events: Event[]) => Promise.resolve(events.slice(0, quantity)),
    queue.asChannel()
  );
};
