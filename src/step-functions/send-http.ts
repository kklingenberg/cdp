import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { HTTP_CLIENT_DEFAULT_CONCURRENCY } from "../conf";
import { Event } from "../event";
import { sendEvents, sendThing } from "../io/http-client";
import { makeChannel } from "../io/jq";
import { PipelineStepFunctionParameters } from ".";

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
 * Validate send-http options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (): void => {
  // Nothing needs to be validated.
};

/**
 * Function that sends events to a remote HTTP endpoint, ignores the
 * response and forwards the events to the pipeline.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that forwards events via HTTP.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
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
      new AsyncQueue<Event[]>(
        `step.${params.stepName}.send-http.accumulating`
      ).asChannel(),
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
  const queue = new AsyncQueue<Event[]>(
    `step.${params.stepName}.send-http.forward`
  );
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
