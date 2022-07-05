import { match, P } from "ts-pattern";
import { Channel, flatMap } from "../async-queue";
import {
  Event,
  makeOldEventParser,
  parseChannel,
  WrapDirective,
  wrapDirectiveSchema,
  chooseParser,
  makeWrapper,
  validateWrap,
} from "../event";
import { check } from "../utils";
import { makeChannel } from "../io/jq";
import { PipelineStepFunctionParameters } from ".";

/**
 * Options for this function.
 */
export type SendReceiveJqFunctionOptions =
  | string
  | {
      ["jq-expr"]: string;
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
        "jq-expr": { type: "string", minLength: 1 },
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["jq-expr"],
    },
  ],
};

/**
 * Validate send-receive-jq options, after they've been checked by the
 * ajv schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendReceiveJqFunctionOptions
): void => {
  check(
    match(options).with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, `step '${name}' wrap option`)
    )
  );
};

/**
 * Function that transforms events using jq.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The jq program that transforms events.
 * @returns A channel that transforms events via jq.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: SendReceiveJqFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const program = typeof options === "string" ? options : options["jq-expr"];
  const parse = chooseParser((typeof options === "string" ? {} : options).wrap);
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options).wrap
  );
  const parser = makeOldEventParser(
    params.pipelineName,
    params.pipelineSignature
  );
  const channel: Channel<Event[], unknown> = await makeChannel(program, {
    parse,
    prelude: params["jq-prelude"],
  });
  return parseChannel(
    flatMap(async (d) => [wrapper(d)], channel),
    parser,
    "parsing jq output"
  );
};
