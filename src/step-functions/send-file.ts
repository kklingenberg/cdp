import { appendFile as appendFileCallback } from "fs";
import { promisify } from "util";
import { Channel, AsyncQueue, flatMap } from "../async-queue";
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
  let promiseChain: Promise<void> = Promise.resolve();
  let forwarder: (events: Event[]) => void = (events: Event[]) => {
    const output =
      events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    promiseChain = promiseChain
      .then(() => appendFile(path, output))
      .catch((err) => logger.error(`Couldn't append to file ${path}: ${err}`));
  };
  let closeExternal: () => Promise<void> = async () => {
    // Empty function
  };
  if (typeof options === "object" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], unknown> = await makeChannel(
      options["jq-expr"]
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
    // Start the sending of jq output to STDOUT.
    promiseChain = (async () => {
      for await (const response of jqChannel.receive) {
        try {
          await appendFile(
            path,
            (typeof response === "string"
              ? response
              : JSON.stringify(response)) + "\n"
          );
        } catch (err) {
          logger.error(`Couldn't append to file ${path}: ${err}`);
        }
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
      await promiseChain;
    },
  };
};
