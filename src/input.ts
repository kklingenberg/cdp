import { Channel, AsyncQueue } from "./async-queue";
import { HTTP_SERVER_DEFAULT_PORT, POLL_INPUT_DEFAULT_INTERVAL } from "./conf";
import { Event, makeNewEventParser, parseChannel, makeWrapper } from "./event";
import { axiosInstance } from "./io/axios";
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
  const wrapper = makeWrapper(options?.wrap);
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
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options)?.wrap
  );
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
export const makePollInput = (
  pipelineName: string,
  pipelineSignature: string,
  options:
    | string
    | {
        target: string;
        seconds?: number | string;
        headers?: { [key: string]: string | number | boolean };
        wrap?: string;
      }
): [Channel<never, Event>, Promise<void>] => {
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options)?.wrap
  );
  const target = typeof options === "string" ? options : options.target;
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const queue = new AsyncQueue<unknown>();
  // One poll is a GET request to the target.
  const fetchOne = async () => {
    try {
      const response = await axiosInstance.get(target, { headers });
      logger.info(
        "Got response from poll target",
        target,
        ":",
        response.status
      );
      for await (const thing of parse(response.data)) {
        queue.push(wrapper(thing));
      }
    } catch (err) {
      logger.warn("Couldn't fetch data from poll target", target, ":", err);
    }
  };
  // Start polling.
  const lapse =
    typeof options === "string"
      ? POLL_INPUT_DEFAULT_INTERVAL
      : typeof options.seconds === "string"
      ? parseFloat(options.seconds)
      : options.seconds ?? POLL_INPUT_DEFAULT_INTERVAL;
  const interval = setInterval(fetchOne, lapse);
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
        },
      },
      eventParser,
      "parsing HTTP response"
    ),
    drained,
  ];
};
