import { Channel, flatMap } from "../async-queue";
import {
  Event,
  makeOldEventParser,
  parseChannel,
  WrapDirective,
  wrapDirectiveSchema,
  chooseParser,
  makeWrapper,
} from "../event";
import { makeChannel } from "../io/jq";

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
 * Function that transforms events using jq.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param options The jq program that transforms events.
 * @returns A channel that transforms events via jq.
 */
export const make = async (
  pipelineName: string,
  pipelineSignature: string,
  options: SendReceiveJqFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const program = typeof options === "string" ? options : options["jq-expr"];
  const parse = chooseParser((typeof options === "string" ? {} : options).wrap);
  const wrapper = makeWrapper(
    (typeof options === "string" ? {} : options).wrap
  );
  const parser = makeOldEventParser(pipelineName, pipelineSignature);
  const channel: Channel<Event[], unknown> = await makeChannel(program, parse);
  return parseChannel(
    flatMap(async (d) => [wrapper(d)], channel),
    parser,
    "parsing jq output"
  );
};
