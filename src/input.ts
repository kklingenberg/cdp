import { Channel, AsyncQueue } from "./async-queue";
import { HTTP_SERVER_DEFAULT_PORT } from "./conf";
import { Event, makeNewEventParser, parseChannel } from "./event";
import { parse } from "./io/read-stream";
import { makeHTTPServer } from "./io/http-server";
import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input");

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
export const makeSTDINInput = (
  pipelineName: string,
  pipelineSignature: string,
  options: { wrap?: string } | null
): [Channel<never, Event>, Promise<void>] => {
  const wrapper: (d: unknown) => unknown =
    options !== null && typeof options.wrap === "string"
      ? ((n) => (d) => ({ n, d }))(options.wrap)
      : (d) => d;
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const rawReceive = parse(process.stdin);
  let notifyDrained: () => void;
  const drained: Promise<void> = new Promise((resolve) => {
    notifyDrained = resolve;
  });
  async function* receive() {
    for await (const value of rawReceive) {
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
        },
      },
      eventParser,
      "parsing raw STDIN input"
    ),
    drained,
  ];
};

/**
 * Creates an input channel based on data coming from HTTP. Returns a
 * pair of [channel, endPromise].
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The HTTP options to configure the input channel.
 * @returns A channel that implicitly receives data from an HTTP
 * endpoint and forwards parsed events, and a promise that resolves
 * when the input ends for any reason.
 */
export const makeHTTPInput = (
  pipelineName: string,
  pipelineSignature: string,
  options: string | { endpoint: string; port?: number | string; wrap?: string }
): [Channel<never, Event>, Promise<void>] => {
  const wrapper: (d: unknown) => unknown =
    typeof options !== "string" && typeof options.wrap === "string"
      ? ((n) => (d) => ({ n, d }))(options.wrap)
      : (d) => d;
  const endpoint = typeof options === "string" ? options : options.endpoint;
  const rawPort: number | string =
    typeof options === "string"
      ? HTTP_SERVER_DEFAULT_PORT
      : options.port ?? HTTP_SERVER_DEFAULT_PORT;
  const port = typeof rawPort === "string" ? parseInt(rawPort) : rawPort;
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const queue = new AsyncQueue<unknown>();
  const server = makeHTTPServer(endpoint, port, async (ctx) => {
    for await (const thing of parse(ctx.req, ctx.request.length)) {
      queue.push(wrapper(thing));
    }
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
          await server.close();
          await channel.close();
        },
      },
      eventParser,
      "parsing HTTP request body"
    ),
    server.closed,
  ];
};
