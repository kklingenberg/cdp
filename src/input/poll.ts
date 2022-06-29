import { match, P } from "ts-pattern";
import { Channel, AsyncQueue } from "../async-queue";
import { POLL_INPUT_DEFAULT_INTERVAL } from "../conf";
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
import { axiosInstance } from "../io/axios";
import { makeLogger } from "../log";
import { backpressure } from "../metrics";
import { check } from "../utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/poll");

/**
 * Options for this input form.
 */
export type PollInputOptions =
  | string
  | {
      target: string;
      seconds?: number | string;
      headers?: { [key: string]: string | number | boolean };
      wrap?: WrapDirective;
    };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: {
        target: { type: "string", minLength: 1 },
        seconds: {
          anyOf: [
            { type: "number", exclusiveMinimum: 0 },
            { type: "string", pattern: "^[0-9]+\\.?[0-9]*$" },
          ],
        },
        headers: {
          type: "object",
          properties: {},
          additionalProperties: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
            ],
          },
        },
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["target"],
    },
  ],
};

/**
 * Validate poll input options, after they've been checked by the ajv
 * schema.
 *
 * @param options The options to validate.
 */
export const validate = (options: PollInputOptions): void => {
  const matchOptions = match(options);
  check(
    matchOptions.with(
      { seconds: P.select(P.string) },
      (seconds) => parseFloat(seconds) > 0
    ),
    "the input has an invalid value for poll.seconds (must be > 0)"
  );
  check(
    matchOptions.with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
};

/**
 * Creates an input channel based on data fetched periodically from
 * HTTP requests to a remote endpoint. Returns a pair of [channel,
 * endPromise].
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The polling options to configure the input channel.
 * @returns A channel that fetches data from a remote endpoint
 * periodically and forwards parsed events, and a promise that
 * resolves when the input ends for any reason.
 */
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options: PollInputOptions
): [Channel<never, Event>, Promise<void>] => {
  const parse = chooseParser(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const target = typeof options === "string" ? options : options.target;
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const queue = new AsyncQueue<unknown>("input.poll");
  // Keep a record of the latest ETag, so as to not duplicate events.
  let latestETag: string | null = null;
  // One poll is a GET request to the target.
  const fetchOne = async () => {
    if (backpressure.status()) {
      return;
    }
    try {
      const response = await axiosInstance.get(target, { headers });
      logger.debug(
        "Got response from poll target",
        target,
        ":",
        response.status
      );
      const etag = response.headers["etag"] ?? null;
      if (latestETag !== null && latestETag === etag) {
        logger.debug(
          "Response was found to be equivalent to previous response; " +
            "it won't be considered."
        );
        return;
      }
      latestETag = etag;
      arrivalTimestamp.update();
      for await (const thing of parse(response.data)) {
        queue.push(wrapper(thing));
      }
    } catch (err) {
      logger.warn("Couldn't fetch data from poll target", target, `: ${err}`);
    }
  };
  // Start polling.
  const lapse =
    typeof options === "string"
      ? POLL_INPUT_DEFAULT_INTERVAL
      : typeof options.seconds === "string"
      ? parseFloat(options.seconds)
      : options.seconds ?? POLL_INPUT_DEFAULT_INTERVAL;
  const interval = setInterval(fetchOne, lapse * 1000);
  // Wrap the queue's channel to make it look like an input channel.
  let notifyDrained: () => void;
  const drained: Promise<void> = new Promise((resolve) => {
    notifyDrained = resolve;
  });
  const channel = queue.asChannel();
  return [
    parseChannel(
      {
        ...channel,
        send: () => {
          logger.warn("Can't send events to an input channel");
          return false;
        },
        close: async () => {
          clearInterval(interval);
          await channel.close();
          notifyDrained();
          logger.debug("Drained poll input");
        },
      },
      eventParser,
      "parsing HTTP response"
    ),
    drained,
  ];
};
