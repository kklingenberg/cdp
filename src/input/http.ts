import { match, P } from "ts-pattern";
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
  validateWrap,
} from "../event";
import { makeHTTPServer } from "../io/http-server";
import { isHealthy } from "../io/jq";
import { makeLogger } from "../log";
import { backpressure } from "../metrics";
import { check } from "../utils";
import { PipelineInputParameters } from ".";

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
 * Validate http input options, after they've been checked by the ajv
 * schema.
 *
 * @param options The options to validate.
 */
export const validate = (options: HTTPInputOptions): void => {
  const matchOptions = match(options);
  check(
    matchOptions.with({ port: P.select(P.string) }, (rawPort) =>
      ((port) => port >= 1 && port <= 65535)(parseInt(rawPort, 10))
    ),
    "the input's http port is invalid (must be between 1 and 65535, inclusive)"
  );
  check(
    matchOptions.with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
};

/**
 * Creates an input channel based on data coming from HTTP. Returns a
 * pair of [channel, endPromise].
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The HTTP options to configure the input channel.
 * @returns A channel that implicitly receives data from an HTTP
 * endpoint and forwards parsed events, and a promise that resolves
 * when the input ends for any reason.
 */
export const make = (
  params: PipelineInputParameters,
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
  const eventParser = makeNewEventParser(
    params.pipelineName,
    params.pipelineSignature
  );
  const queue = new AsyncQueue<unknown>("input.http");
  const server = makeHTTPServer(port, async (ctx) => {
    logger.debug("Received request:", ctx.request.method, ctx.request.path);
    if (ctx.request.method === "POST" && ctx.request.path === endpoint) {
      if (backpressure.status()) {
        ctx.status = 503;
      } else {
        logger.debug("Received events payload:", ctx.request.length, "bytes");
        arrivalTimestamp.update();
        for await (const thing of parse(ctx.req, ctx.request.length)) {
          queue.push(wrapper(thing));
        }
        ctx.body = null;
      }
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
