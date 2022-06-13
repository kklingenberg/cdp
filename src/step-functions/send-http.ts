import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { HTTP_CLIENT_DEFAULT_CONCURRENCY } from "../conf";
import { Event } from "../event";
import { sendEvents, sendThing } from "../io/http-client";
import { makeChannel } from "../io/jq";

/**
 * Options for this function.
 */
export type SendHTTPFunctionOptions =
  | string
  | {
      target: string;
      method?: "POST" | "PUT" | "PATCH";
      ["jq-expr"]?: string;
      headers?: { [key: string]: string | number | boolean };
      concurrent?: number | string;
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
        method: { enum: ["POST", "PUT", "PATCH"] },
        "jq-expr": { type: "string", minLength: 1 },
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
        concurrent: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
          ],
        },
      },
      additionalProperties: false,
      required: ["target"],
    },
  ],
};

/**
 * Function that sends events to a remote HTTP endpoint, ignores the
 * response and forwards the events to the pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that forwards events via HTTP.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  options: SendHTTPFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const target = typeof options === "string" ? options : options.target;
  const method =
    typeof options === "string" ? "POST" : options.method ?? "POST";
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  const concurrent =
    typeof options === "string"
      ? HTTP_CLIENT_DEFAULT_CONCURRENCY
      : typeof options.concurrent === "string"
      ? parseInt(options.concurrent, 10)
      : options.concurrent ?? 10;
  let forwarder: (events: Event[]) => void;
  let closeExternal: () => Promise<void>;
  const requests = new Array<Promise<void>>(concurrent);
  let i = 0;
  if (typeof options !== "string" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], never> = drain(
      await makeChannel(options["jq-expr"]),
      async (response: unknown) => {
        requests[i++] = sendThing(response, target, method, headers);
        if (i === concurrent) {
          await Promise.all(requests);
          i = 0;
        }
      },
      async () => {
        await Promise.all(requests.slice(0, i));
      }
    );
    forwarder = jqChannel.send.bind(jqChannel);
    closeExternal = jqChannel.close.bind(jqChannel);
  } else {
    const accumulatingChannel: Channel<Event[], never> = drain(
      new AsyncQueue<Event[]>().asChannel(),
      async (events: Event[]) => {
        requests[i++] = sendEvents(events, target, method, headers);
        if (i === concurrent) {
          await Promise.all(requests);
          i = 0;
        }
      },
      async () => {
        await Promise.all(requests.slice(0, i));
      }
    );
    forwarder = accumulatingChannel.send.bind(accumulatingChannel);
    closeExternal = accumulatingChannel.close.bind(accumulatingChannel);
  }
  const queue = new AsyncQueue<Event[]>();
  const forwardingChannel = flatMap(async (events: Event[]) => {
    forwarder(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await closeExternal();
    },
  };
};
