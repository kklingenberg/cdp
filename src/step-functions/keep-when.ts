import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";
import { ajv } from "../utils";

/**
 * Function that selects events according to a schema that is compared
 * with each event's data. Event's that don't match the schema are
 * dropped.
 *
 * @param options The schema against which the events are matched.
 * @returns A channel that selects events using a schema.
 */
export const make = async (
  options: object
): Promise<Channel<Event[], Event>> => {
  const matchesSchema = ajv.compile(options);
  const queue = new AsyncQueue<Event[]>();
  return flatMap(
    (events: Event[]) =>
      Promise.resolve(events.filter((event) => matchesSchema(event.data))),
    queue.asChannel()
  );
};
