import Koa from "koa";
import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { Event } from "../event";
import { makeLogger } from "../log";
import { check, getSignature, mergeHeaders } from "../utils";
import { makeHTTPServer } from "../io/http-server";
import { makeChannel } from "../io/jq";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step-functions/expose-http");

/**
 * Options for this function.
 */
export type ExposeHTTPFunctionOptions = {
  endpoint: string;
  port: number | string;
  responses: number | string;
  headers?: { [key: string]: string | string[] };
  ["jq-expr"]?: string;
};

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  type: "object",
  properties: {
    endpoint: { type: "string", minLength: 1, pattern: "^/.*$" },
    port: {
      anyOf: [
        { type: "integer", minimum: 1, maximum: 65535 },
        { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
      ],
    },
    responses: {
      anyOf: [
        { type: "integer", minimum: 1 },
        { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
      ],
    },
    headers: {
      type: "object",
      properties: {},
      additionalProperties: {
        anyOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
    },
    "jq-expr": { type: "string", minLength: 1 },
  },
  additionalProperties: false,
  required: ["endpoint", "port", "responses"],
};

/**
 * Validate expose-http options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: ExposeHTTPFunctionOptions
): void => {
  check(
    match(options).with({ port: P.select(P.string) }, (rawPort) =>
      ((port) => port >= 1 && port <= 65535)(parseInt(rawPort, 10))
    ),
    `step '${name}' uses an invalid expose-http.port value ` +
      "(must be between 1 and 65535, inclusive)"
  );
};

/**
 * Add a thing to the given fully-sized slice at the next index, given
 * that the current index points to a previous location in the slice.
 *
 * @param thing The thing to add to the slice.
 * @param slice The slice that receives the thing.
 * @param currentIndex The current thing-pointing index in slice.
 * @returns The new index that points to the placed thing in slice,
 * and the value that was previously stored there.
 */
const addSliding = <T>(
  thing: T,
  slice: T[],
  currentIndex: number
): [number, T] => {
  const index = (currentIndex + 1) % slice.length;
  const oldThing = slice[index];
  slice[index] = thing;
  return [index, oldThing];
};

/**
 * A response is the body and the content type.
 */
interface Response {
  body: string;
  type: string | null;
}

/**
 * Builds a pair of (ETag, Response) for a given window.
 *
 * @param window The window of events to build a response from.
 * @returns The pair of (ETag, Response).
 */
const makeEventWindowResponse = async (
  eventWindow: Event[]
): Promise<[string, Response]> => {
  const body =
    eventWindow.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const signature = await getSignature(body);
  return [signature, { body, type: "application/x-ndjson" }];
};

/**
 * Builds a pair of (ETag, Response) for a given unspecified
 * JSON-encodable thing. If the thing is a string, it's NOT encoded as
 * JSON.
 *
 * @param thing The thing that's turned into a response.
 * @returns The pair of (ETag, Response).
 */
const makeGenericResponse = async (
  thing: unknown
): Promise<[string, Response]> => {
  let body;
  if (typeof thing === "string") {
    body = thing;
  } else {
    body = JSON.stringify(thing);
  }
  const signature = await getSignature(body);
  return [signature, { body, type: null }];
};

/**
 * Function that exposes events in an HTTP endpoint, ignores the
 * requests and forwards the events to the pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to expose events using
 * HTTP.
 * @returns A channel that exposes events via HTTP.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: ExposeHTTPFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const endpoint = options.endpoint.endsWith("/")
    ? options.endpoint.slice(0, -1)
    : options.endpoint;
  const endpointSlash = endpoint + "/";
  const endpointRegExp = new RegExp(`^${endpoint}/([^/]+)/?$`);
  const port =
    typeof options.port === "string"
      ? parseInt(options.port, 10)
      : options.port;
  const headers = options.headers ?? {};
  // Map ETags to indices.
  const responseKeys = new Map<string, number>();
  // Keep them contained in a fixed-size slice.
  const keySlice = new Array<string>(
    typeof options.responses === "string"
      ? parseInt(options.responses, 10)
      : options.responses
  );
  // Keep responses in a plain array.
  const responses = new Array<Response>(keySlice.length);
  // And a pointer to the latest response.
  let currentIndex = keySlice.length - 1;
  // Each response must slide on to the buffer.
  const registerResponse = (key: string, response: Response) => {
    const [newIndex, previousKey] = addSliding(key, keySlice, currentIndex);
    responseKeys.delete(previousKey);
    responseKeys.set(key, newIndex);
    responses[newIndex] = response;
    currentIndex = newIndex;
  };

  let responsesChannel: Channel<Event[], never>;
  if (typeof options["jq-expr"] === "string") {
    responsesChannel = drain(
      await makeChannel(options["jq-expr"]),
      async (thing: unknown) => {
        const [key, response] = await makeGenericResponse(thing);
        registerResponse(key, response);
      }
    );
  } else {
    responsesChannel = drain(
      new AsyncQueue<Event[]>("step.<?>.expoes-http.accumulating").asChannel(),
      async (events: Event[]) => {
        const [key, response] = await makeEventWindowResponse(events);
        registerResponse(key, response);
      }
    );
  }

  const makeLink = (ctx: Koa.Context, key: string) => {
    const path = `${endpoint}/${key}/`;
    if (typeof ctx.request.host !== "undefined") {
      return `<${ctx.request.protocol}://${ctx.request.host}${path}>; rel="next"`;
    } else {
      return `<${path}>; rel="next"`;
    }
  };
  const respond = (ctx: Koa.Context, index: number) => {
    if (typeof responses[index] === "undefined") {
      ctx.status = 503;
    } else {
      const { body, type } = responses[index];
      ctx.body = body;
      const previousIndex = index === 0 ? keySlice.length - 1 : index - 1;
      const previousKey =
        previousIndex === currentIndex ? undefined : keySlice[previousIndex];
      ctx.set(
        mergeHeaders(
          headers,
          type !== null ? { "Content-Type": type } : {},
          typeof previousKey !== "undefined"
            ? { Link: makeLink(ctx, previousKey) }
            : {},
          { ETag: `"${keySlice[index]}"` }
        )
      );
    }
  };
  const server = makeHTTPServer(port, async (ctx) => {
    logger.debug("Received request:", ctx.request.method, ctx.request.path);
    if (ctx.request.method === "GET") {
      if (ctx.request.path === endpoint || ctx.request.path === endpointSlash) {
        respond(ctx, currentIndex);
        return;
      } else {
        const match = ctx.request.path.match(endpointRegExp);
        if (match !== null) {
          const key = match[1];
          const index = responseKeys.get(key);
          if (typeof index !== "undefined") {
            respond(ctx, index);
            return;
          }
        }
      }
    }
    logger.info(
      "Received unrecognized request:",
      ctx.request.method,
      ctx.request.path
    );
    ctx.status = 404;
  });

  const forwardingChannel = flatMap(async (events: Event[]) => {
    responsesChannel.send(events);
    return events;
  }, new AsyncQueue<Event[]>("step.<?>.expose-http.forward").asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await responsesChannel.close();
      await server.close();
    },
  };
};
