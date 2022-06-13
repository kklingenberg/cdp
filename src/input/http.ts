import { Channel, AsyncQueue } from "../async-queue";
import { HTTP_SERVER_DEFAULT_PORT, HTTP_SERVER_HEALTH_ENDPOINT } from "../conf";
import {
  Event,
  arrivalTimestamp,
  makeNewEventParser,
  parseChannel,
  WrapDirective,
  wrapDirectiveSchema,
  chooseParser,
  makeWrapper,
} from "../event";
import { makeHTTPServer } from "../io/http-server";
import { isHealthy } from "../io/jq";
import { makeLogger } from "../log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("input/http");

/**
 * Options for this input form.
 */
export type HTTPInputOptions =
  | string
  | { endpoint: string; port?: number | string; wrap?: WrapDirective };

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    { type: "string", minLength: 1, pattern: "^/.*$" },
    {
      type: "object",
      properties: {
        endpoint: { type: "string", minLength: 1, pattern: "^/.*$" },
        port: {
          anyOf: [
            { type: "integer", minimum: 1, maximum: 65535 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["endpoint"],
    },
  ],
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
export const make = (
  pipelineName: string,
  pipelineSignature: string,
  options: HTTPInputOptions
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
  const server = makeHTTPServer(port, async (ctx) => {
    logger.debug("Received request:", ctx.request.method, ctx.request.path);
    if (ctx.request.method === "POST" && ctx.request.path === endpoint) {
      logger.debug("Received events payload:", ctx.request.length, "bytes");
      arrivalTimestamp.update();
      for await (const thing of parse(ctx.req, ctx.request.length)) {
        queue.push(wrapper(thing));
      }
      ctx.body = null;
    } else if (
      ctx.request.method === "GET" &&
      ctx.request.path === HTTP_SERVER_HEALTH_ENDPOINT
    ) {
      ctx.type = "application/health+json";
      if (isHealthy()) {
        ctx.body = JSON.stringify({ status: "pass" });
      } else {
        logger.warn("Notified unhealthy status");
        ctx.body = JSON.stringify({ status: "fail" });
        ctx.status = 500;
      }
    } else {
      logger.info(
        "Received unrecognized request:",
        ctx.request.method,
        ctx.request.path
      );
      ctx.status = 404;
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
