import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap, drain } from "../async-queue";
import { HTTP_CLIENT_DEFAULT_CONCURRENCY } from "../conf";
import { Event } from "../event";
import { check } from "../utils";
import { sendEvents, sendThing } from "../io/http-client";
import { processor as jqProcessor } from "../io/jq";
import { processor as jsonnetProcessor } from "../io/jsonnet";
import { PipelineStepFunctionParameters } from ".";

/**
 * Options for this function.
 */
export type SendHTTPFunctionOptions =
  | string
  | {
      target: string;
      method?: "POST" | "PUT" | "PATCH";
      "jq-expr"?: string;
      "jsonnet-expr"?: string;
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
export const validate = (
  name: string,
  options: SendHTTPFunctionOptions
): void => {
  check(
    match(options).with(
      { "jq-expr": P.string, "jsonnet-expr": P.string },
      () => false
    ),
    `step '${name}' can't use both jq and jsonnet expressions simultaneously`
  );
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
  let passThroughChannel: Channel<Event[], never>;
  const requests = new Array<Promise<void>>(concurrent);
  let i = 0;
  if (
    typeof options !== "string" &&
    (typeof options["jq-expr"] === "string" ||
      typeof options["jsonnet-expr"] === "string")
  ) {
    passThroughChannel = drain(
      await (typeof options["jq-expr"] === "string"
        ? jqProcessor.makeChannel(options["jq-expr"], {
            prelude: params["jq-prelude"],
          })
        : typeof options["jsonnet-expr"] === "string"
        ? jsonnetProcessor.makeChannel(options["jsonnet-expr"], {
            prelude: params["jsonnet-prelude"],
            stepName: params.stepName,
          })
        : Promise.reject(new Error("shouldn't happen"))),
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
  } else {
    passThroughChannel = drain(
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
  }
  const queue = new AsyncQueue<Event[]>(
    `step.${params.stepName}.send-http.forward`
  );
  const forwardingChannel = flatMap(async (events: Event[]) => {
    passThroughChannel.send(events);
    return events;
  }, queue.asChannel());
  return {
    ...forwardingChannel,
    close: async () => {
      await forwardingChannel.close();
      await passThroughChannel.close();
    },
  };
};
