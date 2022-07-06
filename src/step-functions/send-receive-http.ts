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
import { PipelineStepFunctionParameters, makeProcessorChannel } from ".";

/**
 * Options for this function.
 */
export type SendReceiveHTTPFunctionOptions =
  | string
  | {
      target: string;
      method?: "POST" | "PUT" | "PATCH";
      "jq-expr"?: string;
      "jsonnet-expr"?: string;
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
        "jsonnet-expr": { type: "string", minLength: 1 },
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
  const matchOptions = match(options);
  check(
    matchOptions.with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, `step '${name}' wrap option`)
    )
  );
  check(
    matchOptions.with(
      { "jq-expr": P.string, "jsonnet-expr": P.string },
      () => false
    ),
    `step '${name}' can't use both jq and jsonnet expressions simultaneously`
  );
};

/**
 * Function that sends events to a remote HTTP endpoint, parses the
 * response and interprets it as transformed events, and forwards
 * those events to the pipeline.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The options that indicate how to send events to the
 * remote HTTP endpoint.
 * @returns A channel that uses a remote HTTP endpoint to transform
 * events.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: SendReceiveHTTPFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const target = typeof options === "string" ? options : options.target;
  const method =
    typeof options === "string" ? "POST" : options.method ?? "POST";
  const headers = typeof options === "string" ? {} : options.headers ?? {};
  const wrap = typeof options === "string" ? undefined : options.wrap;
  if (
    typeof options !== "string" &&
    (typeof options["jq-expr"] === "string" ||
      typeof options["jsonnet-expr"] === "string")
  ) {
    const processingChannel: Channel<Event[], unknown> =
      await makeProcessorChannel(params, options);
    return flatMap(
      (thing: unknown) =>
        sendReceiveThing(
          thing,
          params.pipelineName,
          params.pipelineSignature,
          target,
          method,
          headers,
          wrap
        ),
      processingChannel
    );
  } else {
    const queue = new AsyncQueue<Event[]>(
      `step.${params.stepName}.send-receive-http`
    );
    return flatMap(
      (events: Event[]) =>
        sendReceiveEvents(
          events,
          params.pipelineName,
          params.pipelineSignature,
          target,
          method,
          headers,
          wrap
        ),
      queue.asChannel()
    );
  }
};
