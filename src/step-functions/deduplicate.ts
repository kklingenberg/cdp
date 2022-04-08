import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";

/**
 * Remove duplicate events from the given vector. The duplicate events
 * removed are never the first ones encountered for each event
 * identity.
 *
 * @param events Vector of events to remove duplicates from.
 * @returns A new vector of events.
 */
const deduplicate = (events: Event[]): Event[] => {
  const signatures = new Set<string>();
  return events.filter((event) => {
    if (signatures.has(event.signature)) {
      return false;
    }
    signatures.add(event.signature);
    return true;
  });
};

/**
 * Function that removes event duplicates in each batch.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to deduplicate
 * events. This argument is actually ignored, since currently there
 * are no options available.
 * @returns A channel that removes event duplicates.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  options: Record<string, never> | null
  /* eslint-enable @typescript-eslint/no-unused-vars */
): Promise<Channel<Event[], Event>> => {
  const queue = new AsyncQueue<Event[]>();
  return flatMap(
    (events: Event[]) => Promise.resolve(deduplicate(events)),
    queue.asChannel()
  );
};
