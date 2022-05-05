import { openSync as openFile, closeSync as closeFile } from "fs";
import { Readable } from "stream";
import Tail = require("tail-file");
import { Channel, AsyncQueue, flatMap } from "./async-queue";
import { HTTP_SERVER_DEFAULT_PORT, POLL_INPUT_DEFAULT_INTERVAL } from "./conf";
import {
  Event,
  arrivalTimestamp,
  makeNewEventParser,
  parseChannel,
  WrapDirective,
  chooseParser,
  makeWrapper,
} from "./event";
import { axiosInstance } from "./io/axios";
import { makeHTTPServer } from "./io/http-server";
import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input");

/**
 * Creates an input channel that produces events at a fixed rate. It
 * is mainly intended to help with testing pipelines.
 *
 * @param pipelineName The name of the pipeline that will use this
 * input.
 * @param pipelineSignature The signature of the pipeline that will
 * use this input.
 * @param options The generator options to configure the channel.
 * @returns A channel that produces events at a fixed rate, and a
 * promise that never resolves by itself.
 */
export const makeGeneratorInput = (
  pipelineName: string,
  pipelineSignature: string,
  options: { name?: string; seconds?: number | string } | string | null
): [Channel<never, Event>, Promise<void>] => {
  const eventParser = makeNewEventParser(pipelineName, pipelineSignature);
  const n =
    options === null
      ? "_"
      : typeof options === "string"
      ? options
      : options.name ?? "_";
  const durationSeconds =
    options === null
      ? 1
      : typeof options === "string"
      ? 1
      : typeof options.seconds === "string"
      ? parseFloat(options.seconds)
      : options.seconds ?? 1;
  const intervalDuration = durationSeconds * 1000;
  const queue = new AsyncQueue<number>();
  const interval = setInterval(
    () => queue.push(Math.random()),
    intervalDuration
  );
  const channel = flatMap(async (d) => {
    arrivalTimestamp.update();
    const event = await eventParser({ n, d });
    return [event];
  }, queue.asChannel());
  return [
    {
      ...channel,
      send: () => {
        logger.warn("Can't send events to an input channel");
        return false;
      },
      close: async () => {
        clearInterval(interval);
        await channel.close();
      },
    },
    queue.drain,
  ];
};

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
export const makeTailInput = (
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
    logger.error(`Encountered error while tailing '${path}':`, err);
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
  options:
    | string
    | { endpoint: string; port?: number | string; wrap?: WrapDirective }
): [Channel<never, Event>, Promise<void>] => {
  const parse = chooseParser(
    (typeof options === "string" ? {} : options)?.wrap
  );
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
    arrivalTimestamp.update();
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
          logger.debug("Drained HTTP input");
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
        wrap?: WrapDirective;
      }
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
      arrivalTimestamp.update();
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
