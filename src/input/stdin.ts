import { Channel } from "../async-queue";
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
const logger = makeLogger("input/stdin");

/**
 * Creates an input channel based on data coming from STDIN. Returns a
 * pair of [channel, endPromise].
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The STDIN options to configure the input channel.
 * @returns A channel that implicitly receives data from STDIN and
 * forwards parsed events, and a promise that resolves when the input
 * ends for any reason.
 */
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options: { wrap?: WrapDirective } | null
): [Channel<never, Event>, Promise<void>] => {
  const parse = chooseParser(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const wrapper = makeWrapper(options?.wrap);
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const rawReceive = parse(process.stdin);
  let notifyDrained: () => void;
  const drained: Promise<void> = new Promise((resolve) => {
    notifyDrained = resolve;
  });
  async function* receive() {
    for await (const value of rawReceive) {
      arrivalTimestamp.update();
      yield wrapper(value);
    }
    notifyDrained();
  }
  return [
    parseChannel(
      {
        send: () => {
          logger.warn("Can't send events to an input channel");
          return false;
        },
        receive: receive(),
        close: async () => {
          process.stdin.destroy();
          await drained;
          logger.debug("Drained STDIN input");
        },
      },
      eventParser,
      "parsing raw STDIN input"
    ),
    drained,
  ];
};