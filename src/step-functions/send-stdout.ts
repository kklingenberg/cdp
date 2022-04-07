import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { Event } from "../event";
import { makeChannel } from "../io/jq";

/**
 * Function that sends events to STDOUT and forwards them to the
 * pipeline.
 *
 * @param options The options that indicate how to send events to
 * STDOUT (specifically, they indicate wether to use jq as a
 * transformation step).
 * @returns A channel that forwards events to STDOUT.
 */
export const make = async (
  options: { ["jq-expr"]?: string } | null
): Promise<Channel<Event[], Event>> => {
  let forwarder: (events: Event[]) => void = (events: Event[]) =>
    events.forEach((event) => console.log(JSON.stringify(event)));
  let closeExternal: () => Promise<void> = async () => {
    // Empty function
  };
  if (options !== null && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], unknown> = await makeChannel(
      options["jq-expr"]
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
    // Start the sending of jq output to STDOUT.
    (async () => {
      for await (const response of jqChannel.receive) {
        console.log(
          typeof response === "string" ? response : JSON.stringify(response)
        );
      }
    })();
  }
  const queue = new AsyncQueue<Event[]>();
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await closeExternal();
      await forwardingChannel.close();
    },
  };
};
