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
import { processor } from "../io/jsonnet";
import { PipelineStepFunctionParameters } from ".";

/**
 * Options for this function.
 */
export type SendReceiveJsonnetFunctionOptions =
  | string
  | {
      "jsonnet-expr": string;
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
        "jsonnet-expr": { type: "string", minLength: 1 },
        wrap: wrapDirectiveSchema,
      },
      additionalProperties: false,
      required: ["jsonnet-expr"],
    },
  ],
};

/**
 * Validate send-receive-jsonnet options, after they've been checked
 * by the ajv schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (
  name: string,
  options: SendReceiveJsonnetFunctionOptions
): void => {
  check(
    match(options).with({ wrap: P.select() }, (wrap) =>
      validateWrap(wrap, `step '${name}' wrap option`)
    )
  );
};

/**
 * Function that transforms events using jsonnet.
 *
 * @param params Configuration parameters acquired from the pipeline.
 * @param options The jsonnet program that transforms events.
 * @returns A channel that transforms events via jsonnet.
 */
export const make = async (
  params: PipelineStepFunctionParameters,
  options: SendReceiveJsonnetFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const program =
    typeof options === "string" ? options : options["jsonnet-expr"];
  const parse = chooseParser((typeof options === "string" ? {} : options).wrap);
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options).wrap
  );
  const parser = makeOldEventParser(
    params.pipelineName,
    params.pipelineSignature
  );
  const channel: Channel<Event[], unknown> = await processor.makeChannel(
    program,
    {
      parse,
      prelude: params["jsonnet-prelude"],
      stepName: params.stepName,
    }
  );
  return parseChannel(
    flatMap(async (d) => [wrapper(d)], channel),
    parser,
    "parsing jsonnet output"
  );
};
