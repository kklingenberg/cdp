import { match, P } from "ts-pattern";
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
  wrapDirectiveSchema,
  chooseParser,
  makeWrapper,
  validateWrap,
} from "../event";
import { makeLogger } from "../log";
import { check } from "../utils";
import { PipelineInputParameters } from ".";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/tail");

/**
 * Options for this input form.
 */
export type TailInputOptions =
  | string
  | { path: string; ["start-at"]?: "start" | "end"; wrap?: WrapDirective };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        "start-at": { enum: ["start", "end"] },
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["path"],
    },
  ],
};

/**
 * Validate tail input options, after they've been checked by the ajv
 * schema.
 *
 * @param options The options to validate.
 */
export const validate = (options: TailInputOptions): void => {
  check(
    match(options).with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
};

/**
 * Creates an input channel based on data coming from a file. Returns
 * a pair of [channel, endPromise].
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The tailing options to configure the input channel.
 * @returns A channel that receives data from a file and forwards
 * parsed events, and a promise that resolves when the input ends for
 * any reason.
 */
export const make = (
  params: PipelineInputParameters,
  options: TailInputOptions
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
  const eventParser = makeNewEventParser(
    params.pipelineName,
    params.pipelineSignature
  );
  const queue = new AsyncQueue<unknown>("input.tail");
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
