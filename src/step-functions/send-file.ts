import { appendFile as appendFileCallback } from "fs";
import { promisify } from "util";
import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { makeChannel } from "../io/jq";

/**
 * Use fs.appendFile as an async function.
 */
const appendFile: (path: string, data: string) => Promise<void> =
  promisify(appendFileCallback);

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/send-file");

/**
 * Function that appends events to a file and forwards them to the
 * pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to append events to a
 * file.
 * @returns A channel that appends events to a file.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: string | { path: string; ["jq-expr"]?: string }
): Promise<Channel<Event[], Event>> => {
  const path = typeof options === "string" ? options : options.path;
  let forwarder: (events: Event[]) => void;
  let closeExternal: () => Promise<void>;
  if (typeof options === "object" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], never> = drain(
      await makeChannel(options["jq-expr"]),
      async (result: unknown) => {
        try {
          await appendFile(
            path,
            (typeof result === "string" ? result : JSON.stringify(result)) +
              "\n"
          );
        } catch (err) {
          logger.error(`Couldn't append to file ${path}: ${err}`);
        }
      }
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
  } else {
    const accumulatingChannel: Channel<Event[], never> = drain(
      new AsyncQueue<Event[]>().asChannel(),
      async (events: Event[]) => {
        const output =
          events.map((event) => JSON.stringify(event)).join("\n") + "\n";
        try {
          await appendFile(path, output);
        } catch (err) {
          logger.error(`Couldn't append to file ${path}: ${err}`);
        }
      }
    );
    forwarder = accumulatingChannel.send.bind(accumulatingChannel);
    closeExternal = accumulatingChannel.close.bind(accumulatingChannel);
  }
  const queue = new AsyncQueue<Event[]>();
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await closeExternal();
    },
  };
};
