import { Channel, flatMap, compose } from "./async-queue";
import { INPUT_DRAIN_TIMEOUT } from "./conf";
import { Event } from "./event";
import { makeSTDINInput, makeHTTPInput } from "./input";
import { pipelineEvents, stepEvents } from "./metrics";
import { Pattern, patternSchema, isValidPattern } from "./pattern";
import { StepDefinition, Pipeline, validate, run } from "./pipeline";
import { makeWindowed } from "./step";
import { make as makeDeduplicateFunction } from "./step-functions/deduplicate";
import { make as makeKeepFunction } from "./step-functions/keep";
import { make as makeKeepWhenFunction } from "./step-functions/keep-when";
import { make as makeRenameFunction } from "./step-functions/rename";
import { make as makeSendHTTPFunction } from "./step-functions/send-http";
import { make as makeSendReceiveHTTPFunction } from "./step-functions/send-receive-http";
import { make as makeSendReceiveJqFunction } from "./step-functions/send-receive-jq";
import { make as makeSendSTDOUTFunction } from "./step-functions/send-stdout";
import { ajv, getSignature, makeLogger, resolveAfter } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("api");

/**
 * The `stdin` input form ingests events from STDIN.
 */
interface STDINInputTemplate {
  stdin: Record<string, never> | null;
}
const stdinInputTemplateSchema = {
  type: "object",
  properties: {
    stdin: {
      anyOf: [
        { type: "object", properties: {}, additionalProperties: false },
        { type: "null" },
      ],
    },
  },
  additionalProperties: false,
  required: ["stdin"],
};

/**
 * The `http` input form ingests events from an HTTP endpoint.
 */
interface HTTPInputTemplate {
  http:
    | string
    | {
        endpoint: string;
        port?: number | string;
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
 * it receives.
 */
interface DeduplicateFunctionTemplate {
  deduplicate: Record<string, never> | null;
}
const deduplicateFunctionTemplateSchema = {
  type: "object",
  properties: {
    deduplicate: {
      anyOf: [
        { type: "object", properties: {}, additionalProperties: false },
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
 * A `send-http` function emits event batches to a remote HTTP
 * endpoint, ignores the response entirely and forwards the original
 * events to the rest of the pipeline.
 */
interface SendHTTPFunctionTemplate {
  ["send-http"]:
    | string
    | {
        target: string;
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
        ["jq-expr"]?: string;
        headers?: { [key: string]: string | number | boolean };
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
  required: ["send-receive-http"],
};

/**
 * A pipeline template contains all the fields required to instantiate
 * and run a pipeline.
 */
interface PipelineTemplate {
  name: string;
  input: STDINInputTemplate | HTTPInputTemplate;
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
        | SendHTTPFunctionTemplate
        | SendReceiveJqFunctionTemplate
        | SendReceiveHTTPFunctionTemplate;
      reduce?:
        | RenameFunctionTemplate
        | DeduplicateFunctionTemplate
        | KeepFunctionTemplate
        | KeepWhenFunctionTemplate
        | SendSTDOUTFunctionTemplate
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
    input: { anyOf: [stdinInputTemplateSchema, httpInputTemplateSchema] },
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
  // 1. Check that the input port is valid, if given as a string.
  const { input } = thing as { input: object };
  if ("http" in input) {
    const { http } = input as { http: object };
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
  pipelineEvents.inc({ pipeline: template.name, flow: "in" }, 0);
  pipelineEvents.inc({ pipeline: template.name, flow: "out" }, 0);
  // Create the input channel.
  const signature = await getSignature(template);
  let inputChannel: Channel<never, Event>;
  let inputEnded: Promise<void>;
  const inputKey = Object.keys(template.input)[0];
  switch (inputKey) {
    case "http":
      [inputChannel, inputEnded] = makeHTTPInput(
        template.name,
        signature,
        (template.input as HTTPInputTemplate).http
      );
      break;
    case "stdin":
    default:
      [inputChannel, inputEnded] = makeSTDINInput(
        template.name,
        signature,
        (template.input as STDINInputTemplate).stdin
      );
      break;
  }
  // Create the pipeline channel.
  const steps: StepDefinition[] = [];
  for (const [name, definition] of Object.entries(template.steps ?? {})) {
    // Zero step metrics.
    stepEvents.inc({ pipeline: template.name, step: name, flow: "in" }, 0);
    stepEvents.inc({ pipeline: template.name, step: name, flow: "out" }, 0);
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
      pipelineEvents.inc({ pipeline: template.name, flow: "in" }, 1);
      return [e];
    }, inputChannel)
  );
  // Start it up.
  const operate = async (): Promise<void> => {
    for await (const event of connectedChannel.receive) {
      // `event` already went through the whole pipeline.
      pipelineEvents.inc({ pipeline: template.name, flow: "out" }, 1);
      logger.debug("Event", event.signature, "reached the end of the pipeline");
    }
  };
  // Schedule the pipeline's close when the input ends by external causes.
  inputEnded
    .then(() => resolveAfter(INPUT_DRAIN_TIMEOUT * 1000))
    .then(() => connectedChannel.close());
  return [operate(), connectedChannel.close.bind(connectedChannel)];
};
