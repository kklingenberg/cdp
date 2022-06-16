import { match, P } from "ts-pattern";
import { flatMap, compose } from "./async-queue";
import { INPUT_DRAIN_TIMEOUT, HEALTH_CHECK_INTERVAL } from "./conf";
import { Event, validateWrap } from "./event";
import { isHealthy } from "./io/jq";
import { makeLogger } from "./log";
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
import { ajv, compileThrowing, getSignature, resolveAfter } from "./utils";
// Input forms
import {
  GeneratorInputOptions,
  optionsSchema as generatorInputOptionsSchema,
  make as makeGeneratorInput,
} from "./input/generator";
import {
  STDINInputOptions,
  optionsSchema as stdinInputOptionsSchema,
  make as makeSTDINInput,
} from "./input/stdin";
import {
  TailInputOptions,
  optionsSchema as tailInputOptionsSchema,
  make as makeTailInput,
} from "./input/tail";
import {
  HTTPInputOptions,
  optionsSchema as httpInputOptionsSchema,
  make as makeHTTPInput,
} from "./input/http";
import {
  PollInputOptions,
  optionsSchema as pollInputOptionsSchema,
  make as makePollInput,
} from "./input/poll";
import {
  RedisInputOptions,
  optionsSchema as redisInputOptionsSchema,
  make as makeRedisInput,
} from "./input/redis";
// Step functions
import {
  DeduplicateFunctionOptions,
  optionsSchema as deduplicateFunctionOptionsSchema,
  make as makeDeduplicateFunction,
} from "./step-functions/deduplicate";
import {
  KeepFunctionOptions,
  optionsSchema as keepFunctionOptionsSchema,
  make as makeKeepFunction,
} from "./step-functions/keep";
import {
  KeepWhenFunctionOptions,
  optionsSchema as keepWhenFunctionOptionsSchema,
  make as makeKeepWhenFunction,
} from "./step-functions/keep-when";
import {
  RenameFunctionOptions,
  optionsSchema as renameFunctionOptionsSchema,
  make as makeRenameFunction,
} from "./step-functions/rename";
import {
  ExposeHTTPFunctionOptions,
  optionsSchema as exposeHTTPFunctionOptionsSchema,
  make as makeExposeHTTPFunction,
} from "./step-functions/expose-http";
import {
  SendHTTPFunctionOptions,
  optionsSchema as sendHTTPFunctionOptionsSchema,
  make as makeSendHTTPFunction,
} from "./step-functions/send-http";
import {
  SendReceiveHTTPFunctionOptions,
  optionsSchema as sendReceiveHTTPFunctionOptionsSchema,
  make as makeSendReceiveHTTPFunction,
} from "./step-functions/send-receive-http";
import {
  SendReceiveJqFunctionOptions,
  optionsSchema as sendReceiveJqFunctionOptionsSchema,
  make as makeSendReceiveJqFunction,
} from "./step-functions/send-receive-jq";
import {
  SendFileFunctionOptions,
  optionsSchema as sendFileFunctionOptionsSchema,
  make as makeSendFileFunction,
} from "./step-functions/send-file";
import {
  SendSTDOUTFunctionOptions,
  optionsSchema as sendSTDOUTFunctionOptionsSchema,
  make as makeSendSTDOUTFunction,
} from "./step-functions/send-stdout";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("api");

/**
 * Build an ajv schema for an object with a single key and a subschema
 * for the value.
 *
 * @param key The single key found in the expected objects.
 * @param schema The schema for the value mapped to the key.
 * @returns A schema for the wrapped objects.
 */
const makeWrapperSchema = (key: string, schema: object) => ({
  type: "object",
  properties: { [key]: schema },
  additionalProperties: false,
  required: [key],
});

/**
 * An input template is one of the provided ones.
 **/
type InputTemplate =
  | { generator: GeneratorInputOptions }
  | { stdin: STDINInputOptions }
  | { tail: TailInputOptions }
  | { http: HTTPInputOptions }
  | { poll: PollInputOptions }
  | { redis: RedisInputOptions };
const inputTemplateSchema = {
  anyOf: [
    makeWrapperSchema("generator", generatorInputOptionsSchema),
    makeWrapperSchema("stdin", stdinInputOptionsSchema),
    makeWrapperSchema("tail", tailInputOptionsSchema),
    makeWrapperSchema("http", httpInputOptionsSchema),
    makeWrapperSchema("poll", pollInputOptionsSchema),
    makeWrapperSchema("redis", redisInputOptionsSchema),
  ],
};

/**
 * A step function template is one of the provided ones.
 **/
type StepFunctionTemplate =
  | { rename: RenameFunctionOptions }
  | { deduplicate: DeduplicateFunctionOptions }
  | { keep: KeepFunctionOptions }
  | { "keep-when": KeepWhenFunctionOptions }
  | { "send-stdout": SendSTDOUTFunctionOptions }
  | { "send-file": SendFileFunctionOptions }
  | { "send-http": SendHTTPFunctionOptions }
  | { "expose-http": ExposeHTTPFunctionOptions }
  | { "send-receive-jq": SendReceiveJqFunctionOptions }
  | { "send-receive-http": SendReceiveHTTPFunctionOptions };
const stepFunctionTemplateSchema = {
  anyOf: [
    makeWrapperSchema("rename", renameFunctionOptionsSchema),
    makeWrapperSchema("deduplicate", deduplicateFunctionOptionsSchema),
    makeWrapperSchema("keep", keepFunctionOptionsSchema),
    makeWrapperSchema("keep-when", keepWhenFunctionOptionsSchema),
    makeWrapperSchema("send-stdout", sendSTDOUTFunctionOptionsSchema),
    makeWrapperSchema("send-file", sendFileFunctionOptionsSchema),
    makeWrapperSchema("send-http", sendHTTPFunctionOptionsSchema),
    makeWrapperSchema("expose-http", exposeHTTPFunctionOptionsSchema),
    makeWrapperSchema("send-receive-jq", sendReceiveJqFunctionOptionsSchema),
    makeWrapperSchema(
      "send-receive-http",
      sendReceiveHTTPFunctionOptionsSchema
    ),
  ],
};

/**
 * A pipeline template contains all the fields required to instantiate
 * and run a pipeline.
 */
interface PipelineTemplate {
  name: string;
  input: InputTemplate;
  steps?: {
    [key: string]: {
      after?: string[];
      ["match/drop"]?: Pattern;
      ["match/pass"]?: Pattern;
      window?: {
        events: number | string;
        seconds: number | string;
      };
      flatmap?: StepFunctionTemplate;
      reduce?: StepFunctionTemplate;
    };
  };
}
const pipelineTemplateSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    input: inputTemplateSchema,
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
          flatmap: stepFunctionTemplateSchema,
          reduce: stepFunctionTemplateSchema,
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
const validatePipelineTemplate = compileThrowing(pipelineTemplateSchema);

/**
 * Extract the type of ts-pattern's match objects for boolean returns.
 */
class BooleanMatchTypeExtractor<T> {
  wrappedMatch(v: T) {
    return match<T, boolean>(v);
  }
}
type BooleanMatch<T> = ReturnType<BooleanMatchTypeExtractor<T>["wrappedMatch"]>;

/**
 * Parses and creates a pipeline template from a raw structure. Throws
 * an error with an explanation message in case the given structure
 * can't be translated into a pipeline template.
 *
 * @param thing The raw structure that should map onto a pipeline
 * template.
 * @returns The freshly created pipeline template.
 */
export const makePipelineTemplate = (rawThing: unknown): PipelineTemplate => {
  const thing = validatePipelineTemplate(rawThing) as PipelineTemplate;
  // Explicitly check what the schema couldn't declare as a
  // restriction.
  const check = <T>(m: BooleanMatch<T>, message?: string): void => {
    if (!m.otherwise(() => true)) {
      throw new Error(message ?? "validation error");
    }
  };
  // 1. Check the input forms.
  const matchInput = match(thing.input);
  check(
    matchInput.with({ generator: P.select(P.string) }, isValidEventName),
    "the input has an invalid value for generator.name: " +
      "it must be a proper event name"
  );
  check(
    matchInput.with(
      { generator: { name: P.select(P.string) } },
      isValidEventName
    ),
    "the input has an invalid value for generator.name: " +
      "it must be a proper event name"
  );
  check(
    matchInput.with(
      { generator: { seconds: P.select(P.string) } },
      (seconds) => parseFloat(seconds) > 0
    ),
    "the input has an invalid value for generator.seconds (must be > 0)"
  );
  check(
    matchInput.with({ stdin: { wrap: P.select() } }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
  check(
    matchInput.with({ tail: { wrap: P.select() } }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
  check(
    matchInput.with({ http: { port: P.select(P.string) } }, (rawPort) =>
      ((port) => port >= 1 && port <= 65535)(parseInt(rawPort, 10))
    ),
    "the input's http port is invalid (must be between 1 and 65535, inclusive)"
  );
  check(
    matchInput.with({ http: { wrap: P.select() } }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
  check(
    matchInput.with(
      { poll: { seconds: P.select(P.string) } },
      (seconds) => parseFloat(seconds) > 0
    ),
    "the input has an invalid value for poll.seconds (must be > 0)"
  );
  check(
    matchInput.with({ poll: { wrap: P.select() } }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
  check(
    matchInput.with({ redis: { wrap: P.select() } }, (wrap) =>
      validateWrap(wrap, "the input's wrap option")
    )
  );
  // 2. Check each step.
  Object.entries(thing.steps ?? {}).forEach(([name, definition]) => {
    const matchStep = match(definition);
    check(
      matchStep.with({ "match/drop": P._, "match/pass": P._ }, () => false),
      `step '${name}' can't use both match/drop and match/pass`
    );
    check(
      matchStep.with({ "match/drop": P.select() }, isValidPattern),
      `step '${name}' has an invalid pattern under match/drop`
    );
    check(
      matchStep.with({ "match/pass": P.select() }, isValidPattern),
      `step '${name}' has an invalid pattern under match/pass`
    );
    check(
      matchStep.with(
        { window: { seconds: P.select(P.string) } },
        (seconds) => parseFloat(seconds) > 0
      ),
      `step '${name}' has an invalid value for window.seconds (must be > 0)`
    );
    check(
      matchStep.with({ flatmap: P._, reduce: P._ }, () => false),
      `step '${name}' can't use both flatmap and reduce`
    );
    check(
      matchStep
        .with({ flatmap: P._ }, () => true)
        .with({ reduce: P._ }, () => true)
        .with({}, () => false),
      `step '${name}' must use one of flatmap or reduce`
    );
    // 2.1 Check specific functions.
    const matchFn = match(
      (definition.flatmap ?? definition.reduce) as StepFunctionTemplate
    );
    check(
      matchFn.with(
        { "keep-when": P.select() },
        (schema) => !!ajv.validateSchema(schema)
      ),
      `step '${name}' uses an invalid schema in keep-when`
    );
    check(
      matchFn.with({ rename: { replace: P.select() } }, isValidEventName),
      `step '${name}' uses an invalid rename.replace value: ` +
        "it must be a proper event name"
    );
    check(
      matchFn.with(
        { rename: { append: P.select(P.string) } },
        (append) =>
          (append.startsWith(".") && isValidEventName(append.slice(1))) ||
          isValidEventName(append)
      ),
      `step '${name}' uses an invalid rename.append value: ` +
        "it must be a proper event name suffix"
    );
    check(
      matchFn.with(
        { rename: { prepend: P.select(P.string) } },
        (prepend) =>
          (prepend.endsWith(".") && isValidEventName(prepend.slice(0, -1))) ||
          isValidEventName(prepend)
      ),
      `step '${name}' uses an invalid rename.prepend value: ` +
        "it must be a proper event name prefix"
    );
    check(
      matchFn.with({ "expose-http": { port: P.select(P.string) } }, (rawPort) =>
        ((port) => port >= 1 && port <= 65535)(parseInt(rawPort, 10))
      ),
      `step '${name}' uses an invalid expose-http.port value ` +
        "(must be between 1 and 65535, inclusive)"
    );
    check(
      matchFn.with({ "send-receive-jq": { wrap: P.select() } }, (wrap) =>
        validateWrap(wrap, `step '${name}' wrap option`)
      )
    );
    check(
      matchFn.with({ "send-receive-http": { wrap: P.select() } }, (wrap) =>
        validateWrap(wrap, `step '${name}' wrap option`)
      )
    );
  });
  // 3. Check the pipeline's graph soundness.
  const dummyStepFactory = () => Promise.reject("not a real step factory");
  const dummyPipeline: Pipeline = {
    name: `${thing.name} -- validation`,
    steps: Object.entries(thing.steps ?? {}).map(([name, definition]) => ({
      name,
      after: definition.after ?? [],
      factory: dummyStepFactory,
    })),
  };
  validate(dummyPipeline);
  return thing;
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
  // Setup initialization arguments.
  const signature = await getSignature(template);
  const ctx: [string, string] = [template.name, signature];
  // Zero pipeline metrics.
  pipelineEvents.inc({ flow: "in" }, 0);
  pipelineEvents.inc({ flow: "out" }, 0);
  deadEvents.set(0);
  // Create the input channel.
  const [inputChannel, inputEnded] = match(template.input)
    .with({ redis: P.select() }, (c) => makeRedisInput(...ctx, c))
    .with({ poll: P.select() }, (c) => makePollInput(...ctx, c))
    .with({ http: P.select() }, (c) => makeHTTPInput(...ctx, c))
    .with({ tail: P.select() }, (c) => makeTailInput(...ctx, c))
    .with({ stdin: P.select() }, (c) => makeSTDINInput(...ctx, c))
    .with({ generator: P.select() }, (c) => makeGeneratorInput(...ctx, c))
    .exhaustive();
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
    const fn = await match(definition[functionMode] as StepFunctionTemplate)
      .with({ "send-receive-http": P.select() }, (f) =>
        makeSendReceiveHTTPFunction(...ctx, f)
      )
      .with({ "send-receive-jq": P.select() }, (f) =>
        makeSendReceiveJqFunction(...ctx, f)
      )
      .with({ "expose-http": P.select() }, (f) =>
        makeExposeHTTPFunction(...ctx, f)
      )
      .with({ "send-http": P.select() }, (f) => makeSendHTTPFunction(...ctx, f))
      .with({ "send-file": P.select() }, (f) => makeSendFileFunction(...ctx, f))
      .with({ "send-stdout": P.select() }, (f) =>
        makeSendSTDOUTFunction(...ctx, f)
      )
      .with({ "keep-when": P.select() }, (f) => makeKeepWhenFunction(...ctx, f))
      .with({ deduplicate: P.select() }, (f) =>
        makeDeduplicateFunction(...ctx, f)
      )
      .with({ rename: P.select() }, (f) => makeRenameFunction(...ctx, f))
      .with({ keep: P.select() }, (f) => makeKeepFunction(...ctx, f))
      .exhaustive();
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
