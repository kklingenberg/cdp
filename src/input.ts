import { Channel } from "./async-queue";
import { Event, makeNewEventParser, parseChannel } from "./event";
import { parse } from "./io/read-stream";
import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input");

/**
 * Creates an input channel based on data coming from STDIN.
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The STDIN options to configure the input channel.
 * @returns A channel that implicitly receives data from STDIN, and
 * forwards parsed events.
 */
export const makeSTDINInput = (
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-disable @typescript-eslint/no-unused-vars */
  options: Record<string, never> | null
  /* eslint-enable @typescript-eslint/no-unused-vars */
): Channel<never, Event> => {
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const rawReceive = parse(process.stdin);
  let notifyDrained: () => void;
  const drained: Promise<void> = new Promise((resolve) => {
    notifyDrained = resolve;
  });
  async function* receive() {
    for await (const value of rawReceive) {
      yield value;
    }
    notifyDrained();
  }
  return parseChannel(
    {
      send: () => {
        logger.warn("Can't send events to an input channel");
        return false;
      },
      receive: receive(),
      close: async () => {
        process.stdin.destroy();
        await drained;
      },
    },
    eventParser,
    "parsing raw STDIN input"
  );
};

/**
 * Creates an input channel based on data coming from HTTP.
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The HTTP options to configure the input channel.
 * @returns A channel that implicitly receives data from an HTTP
 * endpoint, and forwards parsed events.
 */
export const makeHTTPInput = (
  pipelineName: string,
  pipelineSignature: string,
  options: string | { endpoint: string; port?: number | string }
): Channel<never, Event> => {
  throw new Error("TODO: http input not implemented");
};
