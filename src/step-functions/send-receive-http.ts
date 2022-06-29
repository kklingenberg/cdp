import { match, P } from "ts-pattern";
import { Channel, AsyncQueue, flatMap } from "../async-queue";
import {
  Event,
  WrapDirective,
  wrapDirectiveSchema,
  validateWrap,
} from "../event";
import { check } from "../utils";
import { sendReceiveEvents, sendReceiveThing } from "../io/http-client";
import { makeChannel } from "../io/jq";

/**
 * Options for this function.
 */
export type SendReceiveHTTPFunctionOptions =
  | string
  | {
      target: string;
      method?: "POST" | "PUT" | "PATCH";
      ["jq-expr"]?: string;
      headers?: { [key: string]: string | number | boolean };
      wrap?: WrapDirective;
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
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["target"],
    },
  ],
};

/**
 * Validate send-receive-http options, after they've been checked by
 * the ajv schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendReceiveHTTPFunctionOptions
): void => {
  check(
    match(options).with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, `step '${name}' wrap option`)
    )
  );
};

/**
 * Function that sends events to a remote HTTP endpoint, parses the
 * response and interprets it as transformed events, and forwards
 * those events to the pipeline.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that uses a remote HTTP endpoint to transform
 * events.
 */
export const make = async (
  pipelineName: string,
  pipelineSignature: string,
  options: SendReceiveHTTPFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const target = typeof options === "string" ? options : options.target;
  const method =
    typeof options === "string" ? "POST" : options.method ?? "POST";
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  const wrap = typeof options === "string" ? undefined : options.wrap;
  if (typeof options !== "string" && typeof options["jq-expr"] === "string") {
    const jqChannel: Channel<Event[], unknown> = await makeChannel(
      options["jq-expr"]
    );
    return flatMap(
      (thing: unknown) =>
        sendReceiveThing(
          thing,
          pipelineName,
          pipelineSignature,
          target,
          method,
          headers,
          wrap
        ),
      jqChannel
    );
  } else {
    const queue = new AsyncQueue<Event[]>("step.<?>.send-receive-http");
    return flatMap(
      (events: Event[]) =>
        sendReceiveEvents(
          events,
          pipelineName,
          pipelineSignature,
          target,
          method,
          headers,
          wrap
        ),
      queue.asChannel()
    );
  }
};
