import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";
import { ajv } from "../utils";

/**
 * Function that selects events according to a schema that is compared
 * with each event's data. Event's that don't match the schema are
 * dropped.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The schema against which the events are matched.
 * @returns A channel that selects events using a schema.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
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
