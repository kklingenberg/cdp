import { Channel, flatMap } from "../async-queue";
import { Event, makeOldEventParser, parseChannel, makeWrapper } from "../event";
import { makeChannel } from "../io/jq";

/**
 * Function that transforms events using jq.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The jq program that transforms events.
 * @returns A channel that transforms events via jq.
 */
export const make = async (
  pipelineName: string,
  pipelineSignature: string,
  options: string | { ["jq-expr"]: string; wrap?: string }
): Promise<Channel<Event[], Event>> => {
  const program = typeof options === "string" ? options : options["jq-expr"];
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options).wrap
  );
  const parser = makeOldEventParser(pipelineName, pipelineSignature);
  const channel: Channel<Event[], unknown> = await makeChannel(program);
  return parseChannel(
    flatMap(async (d) => [wrapper(d)], channel),
    parser,
    "parsing jq output"
  );
};
