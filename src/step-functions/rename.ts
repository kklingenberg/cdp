import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event, makeFrom } from "../event";

/**
 * Function that renames events according to the specified options.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to rename events.
 * @returns A channel that renames its events.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: { append?: string; prepend?: string } | { replace: string }
): Promise<Channel<Event[], Event>> => {
  const makeNewName: (name: string) => string =
    "replace" in options
      ? () => options.replace
      : (name) => (options.prepend ?? "") + name + (options.append ?? "");
  const queue = new AsyncQueue<Event[]>();
  return flatMap(
    (events: Event[]) =>
      Promise.all(
        events.map((event) =>
          makeFrom(event, { name: makeNewName(event.name) })
        )
      ),
    queue.asChannel()
  );
};
