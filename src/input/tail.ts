import { openSync as openFile, closeSync as closeFile } from "fs";
import { Readable } from "stream";
import Tail = require("tail-file");
import { Channel, AsyncQueue } from "../async-queue";
import {
  Event,
  arrivalTimestamp,
  makeNewEventParser,
  parseChannel,
  WrapDirective,
  chooseParser,
  makeWrapper,
} from "../event";
import { makeLogger } from "../utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/tail");

/**
 * Creates an input channel based on data coming from a file. Returns
 * a pair of [channel, endPromise].
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The tailing options to configure the input channel.
 * @returns A channel that receives data from a file and forwards
 * parsed events, and a promise that resolves when the input ends for
 * any reason.
 */
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options:
    | string
    | { path: string; ["start-at"]?: "start" | "end"; wrap?: WrapDirective }
): [Channel<never, Event>, Promise<void>] => {
  const parse = chooseParser(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const path = typeof options === "string" ? options : options.path;
  const startPos =
    typeof options === "string" ? "end" : options["start-at"] ?? "end";
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const queue = new AsyncQueue<unknown>();
  // Wrap the queue's channel to make it look like an input channel.
  let notifyDrained: () => void;
  const drained: Promise<void> = new Promise((resolve) => {
    notifyDrained = resolve;
  });
  const channel = queue.asChannel();
  // Reduce the chance of the file not existing before tailing.
  try {
    const fd = openFile(path, "a");
    closeFile(fd);
  } catch (err) {
    logger.warn("Failed to touch file", path);
  }
  // Tail the target file.
  const tail = new Tail(path, { startPos, sep: /\r?\n/ });
  const close = async () => {
    await tail.stop();
    await channel.close();
    notifyDrained();
    logger.debug("Drained tail input");
  };
  tail.on("error", async (err: unknown) => {
    logger.error(`Encountered error while tailing '${path}': ${err}`);
    await close();
  });
  tail.on("line", async (line: string) => {
    arrivalTimestamp.update();
    for await (const value of parse(Readable.from([line]))) {
      queue.push(wrapper(value));
    }
  });
  tail.start();
  return [
    parseChannel(
      {
        ...channel,
        send: () => {
          logger.warn("Can't send events to an input channel");
          return false;
        },
        close,
      },
      eventParser,
      "parsing a tailed file's line"
    ),
    drained,
  ];
};
