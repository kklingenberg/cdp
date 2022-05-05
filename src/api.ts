import { Channel, flatMap, compose } from "./async-queue";
import { INPUT_DRAIN_TIMEOUT, HEALTH_CHECK_INTERVAL } from "./conf";
import {
  Event,
  WrapDirective,
  wrapDirectiveSchema,
  validateWrap,
} from "./event";
import {
  makeGeneratorInput,
  makeSTDINInput,
  makeTailInput,
  makeHTTPInput,
  makePollInput,
} from "./input";
import { isHealthy } from "./io/jq";
import {
  pipelineEvents,
  stepEvents,
  deadEvents,
  startExposingMetrics,
} from "./metrics";
import {
  isValidEventName,
  Pattern,
  patternSchema,
  isValidPattern,
} from "./pattern";
import { StepDefinition, Pipeline, validate, run } from "./pipeline";
import { makeWindowed } from "./step";
import { make as makeDeduplicateFunction } from "./step-functions/deduplicate";
import { make as makeKeepFunction } from "./step-functions/keep";
import { make as makeKeepWhenFunction } from "./step-functions/keep-when";
import { make as makeRenameFunction } from "./step-functions/rename";
import { make as makeSendHTTPFunction } from "./step-functions/send-http";
import { make as makeSendReceiveHTTPFunction } from "./step-functions/send-receive-http";
import { make as makeSendReceiveJqFunction } from "./step-functions/send-receive-jq";
import { make as makeSendFileFunction } from "./step-functions/send-file";
import { make as makeSendSTDOUTFunction } from "./step-functions/send-stdout";
import { ajv, getSignature, makeLogger, resolveAfter } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("api");

/**
 * The `generator` input produces events at a regular rate.
 */
interface GeneratorInputTemplate {
  generator: { name?: string; seconds?: number | string } | string | null;
}
const generatorInputTemplateSchema = {
  type: "object",
  properties: {
    generator: {
      anyOf: [
        {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            seconds: {
              anyOf: [
                { type: "number", exclusiveMinimum: 0 },
                { type: "string", pattern: "^[0-9]+\\.?[0-9]*$" },
              ],
            },
          },
          additionalProperties: false,
          required: [],
        },
        { type: "string", minLength: 1 },
        { type: "null" },
      ],
    },
  },
  additionalProperties: false,
  required: ["generator"],
};

/**
 * The `stdin` input form ingests events from STDIN.
 */
interface STDINInputTemplate {
  stdin: { wrap?: WrapDirective } | null;
}
const stdinInputTemplateSchema = {
  type: "object",
  properties: {
    stdin: {
      anyOf: [
        {
          type: "object",
          properties: { wrap: wrapDirectiveSchema },
          additionalProperties: false,
          required: [],
        },
        { type: "null" },
      ],
    },
  },
  additionalProperties: false,
  required: ["stdin"],
};

/**
 * The `tail` input form ingests events from a file.
 */
interface TailInputTemplate {
  tail:
    | string
    | { path: string; ["start-at"]?: "start" | "end"; wrap?: WrapDirective };
}
const tailInputTemplateSchema = {
  type: "object",
  properties: {
    tail: {
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1 },
            "start-at": { enum: ["start", "end"] },
            wrap: wrapDirectiveSchema,
          },
          additionalProperties: false,
          required: ["path"],
        },
      ],
    },
  },
  additionalProperties: false,
  required: ["tail"],
};

/**
 * The `http` input form ingests events at an HTTP endpoint.
 */
interface HTTPInputTemplate {
  http:
    | string
    | {
        endpoint: string;
        port?: number | string;
        wrap?: WrapDirective;
      };
}
const httpInputTemplateSchema = {
  type: "object",
  properties: {
    http: {
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          properties: {
            endpoint: { type: "string", minLength: 1 },
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
    },
  },
  additionalProperties: false,
  required: ["http"],
};

/**
 * The `poll` input form pulls events by executing HTTP GET requests.
 */
interface PollInputTemplate {
  poll:
    | string
    | {
        target: string;
        seconds?: number | string;
        headers?: { [key: string]: string | number | boolean };
        wrap?: WrapDirective;
      };
}
const pollInputTemplateSchema = {
  type: "object",
  properties: {
    poll: {
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          properties: {
            target: { type: "string", minLength: 1 },
            seconds: {
              anyOf: [
                { type: "number", exclusiveMinimum: 0 },
                { type: "string", pattern: "^[0-9]+\\.?[0-9]*$" },
              ],
            },
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
    },
  },
  additionalProperties: false,
  required: ["poll"],
};

/**
 * A `rename` function changes the name of the events it receives.
 */
interface RenameFunctionTemplate {
  rename:
    | {
        append?: string;
        prepend?: string;
      }
    | { replace: string };
}
const renameFunctionTemplateSchema = {
  type: "object",
  properties: {
    rename: {
      anyOf: [
        {
          type: "object",
          properties: {
            append: { type: "string", minLength: 1 },
            prepend: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
          required: [],
        },
        {
          type: "object",
          properties: {
            replace: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
          required: ["replace"],
        },
      ],
    },
  },
  additionalProperties: false,
  required: ["rename"],
};

/**
 * A `deduplicate` function removes event duplicates from the batches
 * it receives, considering various pieces of the events.
 */
interface DeduplicateFunctionTemplate {
  deduplicate: {
    ["consider-name"]?: boolean;
    ["consider-data"]?: boolean;
    ["consider-trace"]?: boolean;
  } | null;
}
const deduplicateFunctionTemplateSchema = {
  type: "object",
  properties: {
    deduplicate: {
      anyOf: [
        {
          type: "object",
          properties: {
            "consider-name": { type: "boolean" },
            "consider-data": { type: "boolean" },
            "consider-trace": { type: "boolean" },
          },
          additionalProperties: false,
          required: [],
        },
        { type: "null" },
      ],
    },
  },
  additionalProperties: false,
  required: ["deduplicate"],
};

/**
 * A `keep` function limits event batches to a specific size, after
 * windowing.
 */
interface KeepFunctionTemplate {
  keep: number | string;
}
const keepFunctionTemplateSchema = {
  type: "object",
  properties: {
    keep: {
      anyOf: [
        { type: "integer", minimum: 1 },
        { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
      ],
    },
  },
  additionalProperties: false,
  required: ["keep"],
};

/**
 * A `keep-when` function removes events that don't comply with a
 * specific jsonschema.
 */
interface KeepWhenFunctionTemplate {
  ["keep-when"]: object;
}
const keepWhenFunctionTemplateSchema = {
  type: "object",
  properties: {
    "keep-when": { type: "object" },
  },
  additionalProperties: false,
  required: ["keep-when"],
};

/**
 * A `send-stdout` function emits events as serialized JSON to STDOUT,
 * and forwards the received events as-is to the rest of the pipeline.
 */
interface SendSTDOUTFunctionTemplate {
  ["send-stdout"]: {
    ["jq-expr"]?: string;
  } | null;
}
const sendSTDOUTFunctionTemplateSchema = {
  type: "object",
  properties: {
    "send-stdout": {
      anyOf: [
        {
          type: "object",
          properties: {
            "jq-expr": { type: "string", minLength: 1 },
          },
          additionalProperties: false,
          required: [],
        },
        { type: "null" },
      ],
    },
  },
  additionalProperties: false,
  required: ["send-stdout"],
};

/**
 * A `send-file` function appends events as serialized JSON to the
 * specified file, and forwards the received events as-is to the rest
 * of the pipeline.
 */
interface SendFileFunctionTemplate {
  ["send-file"]:
    | string
    | {
        path: string;
        ["jq-expr"]?: string;
      };
}
const sendFileFunctionTemplateSchema = {
  type: "object",
  properties: {
    "send-file": {
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1 },
            "jq-expr": { type: "string", minLength: 1 },
          },
          additionalProperties: false,
          required: ["path"],
        },
      ],
    },
  },
  additionalProperties: false,
  required: ["send-file"],
};

/**
 * A `send-http` function emits event batches to a remote HTTP
 * endpoint, ignores the response entirely and forwards the original
 * events to the rest of the pipeline.
 */
interface SendHTTPFunctionTemplate {
  ["send-http"]:
    | string
    | {
        target: string;
        method?: "POST" | "PUT" | "PATCH";
        ["jq-expr"]?: string;
        headers?: { [key: string]: string | number | boolean };
      };
}
const sendHTTPFunctionTemplateSchema = {
  type: "object",
  properties: {
    "send-http": {
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
          },
          additionalProperties: false,
          required: ["target"],
        },
      ],
    },
  },
  additionalProperties: false,
  required: ["send-http"],
};

/**
 * A `send-receive-jq` function processes batches of events with a jq
 * program, and the transformed events are sent back to the rest of
 * the pipeline.
 */
interface SendReceiveJqFunctionTemplate {
  ["send-receive-jq"]:
    | string
    | {
        ["jq-expr"]: string;
        wrap?: WrapDirective;
      };
}
const sendReceiveJqFunctionTemplateSchema = {
  type: "object",
  properties: {
    "send-receive-jq": {
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
    },
  },
  additionalProperties: false,
  required: ["send-receive-jq"],
};

/**
 * A `send-receive-http` function processes batches of events with a
 * remote HTTP service. The service is expected to respond with the
 * transformed events, which get forwarded to the rest of the
 * pipeline.
 */
interface SendReceiveHTTPFunctionTemplate {
  ["send-receive-http"]:
    | string
    | {
        target: string;
        method?: "POST" | "PUT" | "PATCH";
        ["jq-expr"]?: string;
        headers?: { [key: string]: string | number | boolean };
        wrap?: WrapDirective;
      };
}
const sendReceiveHTTPFunctionTemplateSchema = {
  type: "object",
  properties: {
    "send-receive-http": {
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
    },
  },
  additionalProperties: false,
  required: ["send-receive-http"],
};

/**
 * A pipeline template contains all the fields required to instantiate
 * and run a pipeline.
 */
interface PipelineTemplate {
  name: string;
  input:
    | GeneratorInputTemplate
    | STDINInputTemplate
    | TailInputTemplate
    | HTTPInputTemplate
    | PollInputTemplate;
  steps?: {
    [key: string]: {
      after?: string[];
      ["match/drop"]?: Pattern;
      ["match/pass"]?: Pattern;
      window?: {
        events: number | string;
        seconds: number | string;
      };
      flatmap?:
        | RenameFunctionTemplate
        | DeduplicateFunctionTemplate
        | KeepFunctionTemplate
        | KeepWhenFunctionTemplate
        | SendSTDOUTFunctionTemplate
        | SendFileFunctionTemplate
        | SendHTTPFunctionTemplate
        | SendReceiveJqFunctionTemplate
        | SendReceiveHTTPFunctionTemplate;
      reduce?:
        | RenameFunctionTemplate
        | DeduplicateFunctionTemplate
        | KeepFunctionTemplate
        | KeepWhenFunctionTemplate
        | SendSTDOUTFunctionTemplate
        | SendFileFunctionTemplate
        | SendHTTPFunctionTemplate
        | SendReceiveJqFunctionTemplate
        | SendReceiveHTTPFunctionTemplate;
    };
  };
}
const pipelineTemplateSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    input: {
      anyOf: [
        generatorInputTemplateSchema,
        stdinInputTemplateSchema,
        tailInputTemplateSchema,
        httpInputTemplateSchema,
        pollInputTemplateSchema,
      ],
    },
    steps: {
      type: "object",
      properties: {},
      additionalProperties: {
        type: "object",
        properties: {
          after: { type: "array", items: { type: "string", minLength: 1 } },
          "match/drop": patternSchema,
          "match/pass": patternSchema,
          window: {
            type: "object",
            properties: {
              events: {
                anyOf: [
                  { type: "integer", minimum: 1 },
                  { type: "string", pattern: "^[0-9]*[1-9][0-9]*$" },
                ],
              },
              seconds: {
                anyOf: [
                  { type: "number", exclusiveMinimum: 0 },
                  { type: "string", pattern: "^[0-9]+\\.?[0-9]*$" },
                ],
              },
            },
            additionalProperties: false,
            required: ["events", "seconds"],
          },
          flatmap: {
            anyOf: [
              renameFunctionTemplateSchema,
              deduplicateFunctionTemplateSchema,
              keepFunctionTemplateSchema,
              keepWhenFunctionTemplateSchema,
              sendSTDOUTFunctionTemplateSchema,
              sendFileFunctionTemplateSchema,
              sendHTTPFunctionTemplateSchema,
              sendReceiveJqFunctionTemplateSchema,
              sendReceiveHTTPFunctionTemplateSchema,
            ],
          },
          reduce: {
            anyOf: [
              renameFunctionTemplateSchema,
              deduplicateFunctionTemplateSchema,
              keepFunctionTemplateSchema,
              keepWhenFunctionTemplateSchema,
              sendSTDOUTFunctionTemplateSchema,
              sendFileFunctionTemplateSchema,
              sendHTTPFunctionTemplateSchema,
              sendReceiveJqFunctionTemplateSchema,
              sendReceiveHTTPFunctionTemplateSchema,
            ],
          },
        },
        additionalProperties: false,
        required: [],
      },
    },
  },
  required: ["name", "input"],
};

/**
 * Validate a raw pipeline template using the schema.
 */
const validatePipelineTemplate = ajv.compile(pipelineTemplateSchema);

/**
 * Parses and creates a pipeline template from a raw structure. Throws
 * an error with an explanation message in case the given structure
 * can't be translated into a pipeline template.
 *
 * @param thing The raw structure that should map onto a pipeline
 * template.
 * @returns The freshly created pipeline template.
 */
export const makePipelineTemplate = (thing: unknown): PipelineTemplate => {
  if (!validatePipelineTemplate(thing)) {
    throw new Error(
      validatePipelineTemplate.errors
        ?.map((error) => error.message)
        .join("; ") ?? "pipeline file contains an invalid structure"
    );
  }
  // Explicitly check what the schema couldn't declare as a
  // restriction.
  // 1. Check the input forms.
  const { input } = thing as { input: object };
  if ("generator" in input) {
    const { generator } = input as { generator: object | string | null };
    if (generator !== null) {
      // 1.1 Check that the event name is valid.
      const name =
        typeof generator === "string"
          ? generator
          : (generator as { name?: string }).name;
      if (typeof name === "string" && !isValidEventName(name)) {
        throw new Error(
          "the input has an invalid value for generator.name: " +
            "it must be a proper event name"
        );
      }
    }
    // 1.2 Check that the interval is valid, if given as a string.
    if (
      generator !== null &&
      typeof generator !== "string" &&
      "seconds" in generator
    ) {
      const { seconds } = generator as { seconds?: number | string };
      if (typeof seconds === "string") {
        const numericSeconds = parseFloat(seconds);
        if (numericSeconds <= 0) {
          throw new Error(
            `the input has an invalid value for generator.seconds (must be > 0)`
          );
        }
      }
    }
  }
  if ("poll" in input) {
    const { poll } = input as { poll: object };
    // 1.3 Check that the poll interval is valid, if given as a string.
    if (typeof poll === "object" && "seconds" in poll) {
      const { seconds } = poll as { seconds?: number | string };
      if (typeof seconds === "string") {
        const numericSeconds = parseFloat(seconds);
        if (numericSeconds <= 0) {
          throw new Error(
            `the input has an invalid value for poll.seconds (must be > 0)`
          );
        }
      }
    }
    // 1.4 Check that the wrap directive is valid, if given.
    if (typeof poll === "object" && "wrap" in poll) {
      const { wrap } = poll as { wrap: unknown };
      validateWrap(wrap, "the input's wrap option");
    }
  }
  if ("http" in input) {
    const { http } = input as { http: object };
    // 1.5 Check that the input port is valid, if given as a string.
    if (typeof http === "object" && "port" in http) {
      const { port } = http as { port: unknown };
      if (typeof port === "string") {
        const numericPort = parseInt(port, 10);
        if (numericPort < 1 || numericPort > 65535) {
          throw new Error(
            "the input's http port is invalid (must be between 1 and 65535, inclusive)"
          );
        }
      }
    }
    // 1.6 Check that the wrap directive is valid, if given.
    if (typeof http === "object" && "wrap" in http) {
      const { wrap } = http as { wrap: unknown };
      validateWrap(wrap, "the input's wrap option");
    }
  }
  if ("tail" in input) {
    const { tail } = input as { tail: string | object };
    // 1.7 Check that the wrap directive is valid, if given.
    if (typeof tail === "object" && "wrap" in tail) {
      const { wrap } = tail as { wrap: unknown };
      validateWrap(wrap, "the input's wrap option");
    }
  }
  if ("stdin" in input) {
    const { stdin } = input as { stdin: object | null };
    // 1.8 Check that the wrap directive is valid, if given.
    if (stdin !== null && "wrap" in stdin) {
      const { wrap } = stdin as { wrap: unknown };
      validateWrap(wrap, "the input's wrap option");
    }
  }
  // 2. Check each step.
  const { steps } = thing as { steps: object };
  Object.entries(steps ?? {}).forEach(([name, definition]) => {
    // 2.1 There must be only one of either match/drop or match/pass.
    if ("match/drop" in definition && "match/pass" in definition) {
      throw new Error(
        `step '${name}' can't use both match/drop and match/pass`
      );
    }
    // 2.2 The pattern used must be valid.
    if (
      "match/drop" in definition &&
      !isValidPattern(definition["match/drop"])
    ) {
      throw new Error(`step '${name}' has an invalid pattern under match/drop`);
    }
    if (
      "match/pass" in definition &&
      !isValidPattern(definition["match/pass"])
    ) {
      throw new Error(`step '${name}' has an invalid pattern under match/pass`);
    }
    // 2.3 Window parameters, if given as strings, must be properly bound.
    if ("window" in definition) {
      const { window } = definition as {
        window: { seconds: unknown };
      };
      if (typeof window.seconds === "string") {
        const numericSeconds = parseFloat(window.seconds);
        if (numericSeconds <= 0) {
          throw new Error(
            `step '${name}' has an invalid value for window.seconds (must be > 0)`
          );
        }
      }
    }
    // 2.4 There must be only one of either flatmap or reduce.
    if ("flatmap" in definition && "reduce" in definition) {
      throw new Error(`step '${name}' can't use both flatmap and reduce`);
    }
    if (!("flatmap" in definition || "reduce" in definition)) {
      throw new Error(`step '${name}' must use one of flatmap or reduce`);
    }
    // 2.5 Check specific functions.
    const fn = "flatmap" in definition ? definition.flatmap : definition.reduce;
    // 2.5.1 If using keep-when, the value must be a proper schema.
    if ("keep-when" in fn) {
      if (!ajv.validateSchema(fn["keep-when"])) {
        throw new Error(
          `step '${name}' uses an invalid schema in keep-when: ` +
            ajv.errors?.map((error) => error.message).join("; ") ??
            "invalid schema"
        );
      }
    }
    // 2.5.2 If using rename, the replacement, prefix and suffix must
    // be valid.
    if ("rename" in fn) {
      if ("replace" in fn.rename) {
        if (!isValidEventName(fn.rename.replace)) {
          throw new Error(
            `step '${name}' uses an invalid rename.replace value: ` +
              "it must be a proper event name"
          );
        }
      }
      if ("append" in fn.rename) {
        if (
          (fn.rename.append.startsWith(".") &&
            !isValidEventName(fn.rename.append.slice(1))) ||
          (!fn.rename.append.startsWith(".") &&
            !isValidEventName(fn.rename.append))
        ) {
          throw new Error(
            `step '${name}' uses an invalid rename.append value: ` +
              "it must be a proper event name suffix"
          );
        }
      }
      if ("prepend" in fn.rename) {
        if (
          (fn.rename.prepend.endsWith(".") &&
            !isValidEventName(fn.rename.prepend.slice(0, -1))) ||
          (!fn.rename.append.endsWith(".") &&
            !isValidEventName(fn.rename.prepend))
        ) {
          throw new Error(
            `step '${name}' uses an invalid rename.prepend value: ` +
              "it must be a proper event name prefix"
          );
        }
      }
    }
    // 2.5.3 If using send-receive-jq or send-receive-http, check that
    // the wrap option is valid, if given.
    if ("send-receive-jq" in fn) {
      if (typeof fn["send-receive-jq"] !== "string") {
        if (typeof fn["send-receive-jq"].wrap !== "undefined") {
          validateWrap(
            fn["send-receive-jq"].wrap,
            `step '${name}' wrap option`
          );
        }
      }
    }
    if ("send-receive-http" in fn) {
      if (typeof fn["send-receive-http"] !== "string") {
        if (typeof fn["send-receive-http"].wrap !== "undefined") {
          validateWrap(
            fn["send-receive-http"].wrap,
            `step '${name}' wrap option`
          );
        }
      }
    }
  });
  // 3. Check the pipeline's graph soundness.
  const dummyStepFactory = () => Promise.reject("not a real step factory");
  const dummyPipeline: Pipeline = {
    name: `${thing.name} -- validation`,
    steps: Object.entries(steps ?? {}).map(([name, definition]) => ({
      name,
      after: definition.after ?? [],
      factory: dummyStepFactory,
    })),
  };
  validate(dummyPipeline);
  return thing as unknown as PipelineTemplate;
};

/**
 * Instantiates and runs a pipeline.
 *
 * @param template The pipeline template that describes the pipeline.
 * @returns A promise that resolves to a pair: the first element is a
 * promise (another one) that resolves once the pipeline stops
 * processing; the second element is a thunk that schedules the
 * resolution of the previous promise, including the appropriate
 * cleanups.
 */
export const runPipeline = async (
  template: PipelineTemplate
): Promise<[Promise<void>, () => void]> => {
  // Zero pipeline metrics.
  pipelineEvents.inc({ flow: "in" }, 0);
  pipelineEvents.inc({ flow: "out" }, 0);
  deadEvents.set(0);
  // Create the input channel.
  const signature = await getSignature(template);
  let inputChannel: Channel<never, Event>;
  let inputEnded: Promise<void>;
  const inputKey = Object.keys(template.input)[0];
  switch (inputKey) {
    case "poll":
      [inputChannel, inputEnded] = makePollInput(
        template.name,
        signature,
        (template.input as PollInputTemplate).poll
      );
      break;
    case "http":
      [inputChannel, inputEnded] = makeHTTPInput(
        template.name,
        signature,
        (template.input as HTTPInputTemplate).http
      );
      break;
    case "tail":
      [inputChannel, inputEnded] = makeTailInput(
        template.name,
        signature,
        (template.input as TailInputTemplate).tail
      );
      break;
    case "stdin":
      [inputChannel, inputEnded] = makeSTDINInput(
        template.name,
        signature,
        (template.input as STDINInputTemplate).stdin
      );
      break;
    case "generator":
    default:
      [inputChannel, inputEnded] = makeGeneratorInput(
        template.name,
        signature,
        (template.input as GeneratorInputTemplate).generator
      );
      break;
  }
  // Create the pipeline channel.
  const steps: StepDefinition[] = [];
  for (const [name, definition] of Object.entries(template.steps ?? {})) {
    // Zero step metrics.
    stepEvents.inc({ step: name, flow: "in" }, 0);
    stepEvents.inc({ step: name, flow: "out" }, 0);
    // Extract parameters.
    const window = definition.window ?? { events: 1, seconds: -1 };
    const patternMode: "pass" | "drop" =
      "match/drop" in definition ? "drop" : "pass";
    const pattern =
      "match/drop" in definition
        ? definition["match/drop"]
        : definition["match/pass"];
    const functionMode: "flatmap" | "reduce" =
      "reduce" in definition ? "reduce" : "flatmap";
    const options = {
      name,
      windowMaxSize:
        typeof window.events === "string"
          ? parseInt(window.events, 10)
          : window.events,
      windowMaxDuration:
        typeof window.seconds === "string"
          ? parseFloat(window.seconds)
          : window.seconds,
      pattern,
      patternMode,
      functionMode,
    };
    const fnKey = Object.keys(definition[functionMode] ?? {})[0];
    let fn;
    switch (fnKey) {
      case "send-receive-http":
        fn = await makeSendReceiveHTTPFunction(
          template.name,
          signature,
          (definition[functionMode] as SendReceiveHTTPFunctionTemplate)[
            "send-receive-http"
          ]
        );
        break;
      case "send-receive-jq":
        fn = await makeSendReceiveJqFunction(
          template.name,
          signature,
          (definition[functionMode] as SendReceiveJqFunctionTemplate)[
            "send-receive-jq"
          ]
        );
        break;
      case "send-http":
        fn = await makeSendHTTPFunction(
          template.name,
          signature,
          (definition[functionMode] as SendHTTPFunctionTemplate)["send-http"]
        );
        break;
      case "send-file":
        fn = await makeSendFileFunction(
          template.name,
          signature,
          (definition[functionMode] as SendFileFunctionTemplate)["send-file"]
        );
        break;
      case "send-stdout":
        fn = await makeSendSTDOUTFunction(
          template.name,
          signature,
          (definition[functionMode] as SendSTDOUTFunctionTemplate)[
            "send-stdout"
          ]
        );
        break;
      case "keep-when":
        fn = await makeKeepWhenFunction(
          template.name,
          signature,
          (definition[functionMode] as KeepWhenFunctionTemplate)["keep-when"]
        );
        break;
      case "deduplicate":
        fn = await makeDeduplicateFunction(
          template.name,
          signature,
          (definition[functionMode] as DeduplicateFunctionTemplate).deduplicate
        );
        break;
      case "rename":
        fn = await makeRenameFunction(
          template.name,
          signature,
          (definition[functionMode] as RenameFunctionTemplate).rename
        );
        break;
      case "keep":
      default:
        fn = await makeKeepFunction(
          template.name,
          signature,
          (definition[functionMode] as KeepFunctionTemplate).keep
        );
        break;
    }
    const factory = makeWindowed(options, fn);
    steps.push({
      name,
      after: definition.after ?? [],
      factory,
    });
  }
  const pipelineChannel = await run({ name: template.name, steps });
  // Connect the input's data to the pipeline.
  const connectedChannel = compose(
    pipelineChannel,
    flatMap(async (e: Event) => {
      pipelineEvents.inc({ flow: "in" }, 1);
      return [e];
    }, inputChannel)
  );
  // Expose metrics in openmetrics format.
  const stopExposingMetrics = startExposingMetrics();
  // Start it up.
  const operate = async (): Promise<void> => {
    for await (const event of connectedChannel.receive) {
      // `event` already went through the whole pipeline.
      pipelineEvents.inc({ flow: "out" }, 1);
      logger.debug("Event", event.id, "reached the end of the pipeline");
    }
    logger.debug("Finished pipeline operation");
    await stopExposingMetrics();
  };
  // Monitor the health of the multi-process system and shut
  // everything off if any piece is unhealthy.
  let interval: ReturnType<typeof setInterval> | null = null;
  if (HEALTH_CHECK_INTERVAL > 0) {
    interval = setInterval(() => {
      if (!isHealthy()) {
        logger.error(
          "Pipeline isn't healthy; draining queues and shutting down"
        );
        clearInterval(interval as ReturnType<typeof setInterval>);
        connectedChannel.close();
      }
    }, HEALTH_CHECK_INTERVAL * 1000);
  }
  // Schedule the pipeline's close when the input ends by external causes.
  inputEnded
    .then(() => resolveAfter(INPUT_DRAIN_TIMEOUT * 1000))
    .then(() => {
      if (interval !== null) {
        clearInterval(interval as ReturnType<typeof setInterval>);
      }
      return connectedChannel.close();
    });
  return [
    operate(),
    () => {
      if (interval !== null) {
        clearInterval(interval as ReturnType<typeof setInterval>);
      }
      connectedChannel.close();
    },
  ];
};
