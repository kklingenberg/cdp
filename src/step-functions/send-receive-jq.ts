import { Channel } from "../async-queue";
import { Event, makeOldEventParser, parseChannel } from "../event";
import { makeChannel } from "../io/jq";

/**
 * Function that transforms events using jq.
 *
 * @param options The jq program that transforms events.
 * @returns A channel that transforms events via jq.
 */
export const make = async (
  options: string | { ["jq-expr"]: string }
): Promise<Channel<Event[], Event>> => {
  const program = typeof options === "string" ? options : options["jq-expr"];
  const parser = makeOldEventParser();
  const channel: Channel<Event[], unknown> = await makeChannel(program);
  return parseChannel(channel, parser, "parsing jq output");
};
