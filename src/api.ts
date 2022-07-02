import { match, P } from "ts-pattern";
import { flatMap, compose } from "./async-queue";
import { INPUT_DRAIN_TIMEOUT, HEALTH_CHECK_INTERVAL } from "./conf";
import { Event } from "./event";
import { isHealthy } from "./io/jq";
import { makeLogger } from "./log";
import {
  pipelineEvents,
  stepEvents,
  deadEvents,
  startExposingMetrics,
} from "./metrics";
import { Pattern, patternSchema, isValidPattern } from "./pattern";
import { StepDefinition, Pipeline, validate, run } from "./pipeline";
import { makeWindowed } from "./step";
import { compileThrowing, check, getSignature, resolveAfter } from "./utils";
// Input forms
import * as generatorInputModule from "./input/generator";
import { GeneratorInputOptions } from "./input/generator";
import * as stdinInputModule from "./input/stdin";
import { STDINInputOptions } from "./input/stdin";
import * as tailInputModule from "./input/tail";
import { TailInputOptions } from "./input/tail";
import * as httpInputModule from "./input/http";
import { HTTPInputOptions } from "./input/http";
import * as pollInputModule from "./input/poll";
import { PollInputOptions } from "./input/poll";
import * as amqpInputModule from "./input/amqp";
import { AMQPInputOptions } from "./input/amqp";
import * as mqttInputModule from "./input/mqtt";
import { MQTTInputOptions } from "./input/mqtt";
import * as redisInputModule from "./input/redis";
import { RedisInputOptions } from "./input/redis";
// Step functions
import * as deduplicateFunctionModule from "./step-functions/deduplicate";
import { DeduplicateFunctionOptions } from "./step-functions/deduplicate";
import * as keepFunctionModule from "./step-functions/keep";
import { KeepFunctionOptions } from "./step-functions/keep";
import * as keepWhenFunctionModule from "./step-functions/keep-when";
import { KeepWhenFunctionOptions } from "./step-functions/keep-when";
import * as renameFunctionModule from "./step-functions/rename";
import { RenameFunctionOptions } from "./step-functions/rename";
import * as exposeHTTPFunctionModule from "./step-functions/expose-http";
import { ExposeHTTPFunctionOptions } from "./step-functions/expose-http";
import * as sendAMQPFunctionModule from "./step-functions/send-amqp";
import { SendAMQPFunctionOptions } from "./step-functions/send-amqp";
import * as sendMQTTFunctionModule from "./step-functions/send-mqtt";
import { SendMQTTFunctionOptions } from "./step-functions/send-mqtt";
import * as sendRedisFunctionModule from "./step-functions/send-redis";
import { SendRedisFunctionOptions } from "./step-functions/send-redis";
import * as sendHTTPFunctionModule from "./step-functions/send-http";
import { SendHTTPFunctionOptions } from "./step-functions/send-http";
import * as sendReceiveHTTPFunctionModule from "./step-functions/send-receive-http";
import { SendReceiveHTTPFunctionOptions } from "./step-functions/send-receive-http";
import * as sendReceiveJqFunctionModule from "./step-functions/send-receive-jq";
import { SendReceiveJqFunctionOptions } from "./step-functions/send-receive-jq";
import * as sendFileFunctionModule from "./step-functions/send-file";
import { SendFileFunctionOptions } from "./step-functions/send-file";
import * as sendSTDOUTFunctionModule from "./step-functions/send-stdout";
import { SendSTDOUTFunctionOptions } from "./step-functions/send-stdout";

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
 * Input modules available. Each provides an `optionsSchema` object,
 * and `validate` and `make` functions.
 */
const inputModules = {
  generator: generatorInputModule,
  stdin: stdinInputModule,
  tail: tailInputModule,
  http: httpInputModule,
  poll: pollInputModule,
  amqp: amqpInputModule,
  mqtt: mqttInputModule,
  redis: redisInputModule,
};

/**
 * An input template is one of the provided ones.
 **/
type InputTemplate =
  | { generator: GeneratorInputOptions }
  | { stdin: STDINInputOptions }
  | { tail: TailInputOptions }
  | { http: HTTPInputOptions }
  | { poll: PollInputOptions }
  | { amqp: AMQPInputOptions }
  | { mqtt: MQTTInputOptions }
  | { redis: RedisInputOptions };
const inputTemplateSchema = {
  anyOf: Object.entries(inputModules).map(([key, mod]) =>
    makeWrapperSchema(key, mod.optionsSchema)
  ),
};

/**
 * Step function modules available. Each provides an `optionsSchema`
 * object, a `validate` function, and a `make` asynchronous function.
 */
const stepFunctionModules = {
  rename: renameFunctionModule,
  deduplicate: deduplicateFunctionModule,
  keep: keepFunctionModule,
  "keep-when": keepWhenFunctionModule,
  "send-stdout": sendSTDOUTFunctionModule,
  "send-file": sendFileFunctionModule,
  "send-http": sendHTTPFunctionModule,
  "send-amqp": sendAMQPFunctionModule,
  "send-mqtt": sendMQTTFunctionModule,
  "send-redis": sendRedisFunctionModule,
  "expose-http": exposeHTTPFunctionModule,
  "send-receive-jq": sendReceiveJqFunctionModule,
  "send-receive-http": sendReceiveHTTPFunctionModule,
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
  | { "send-amqp": SendAMQPFunctionOptions }
  | { "send-mqtt": SendMQTTFunctionOptions }
  | { "send-redis": SendRedisFunctionOptions }
  | { "expose-http": ExposeHTTPFunctionOptions }
  | { "send-receive-jq": SendReceiveJqFunctionOptions }
  | { "send-receive-http": SendReceiveHTTPFunctionOptions };
const stepFunctionTemplateSchema = {
  anyOf: Object.entries(stepFunctionModules).map(([key, mod]) =>
    makeWrapperSchema(key, mod.optionsSchema)
  ),
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
  // Check the input form.
  const [inputName, inputOptions] = Object.entries(thing.input)[0];
  inputModules[inputName as keyof typeof inputModules].validate(inputOptions);
  // Check each step.
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
    // Check specific functions.
    const template = (definition.flatmap ??
      definition.reduce) as StepFunctionTemplate;
    const [stepFunctionName, stepFunctionOptions] = Object.entries(template)[0];
    stepFunctionModules[
      stepFunctionName as keyof typeof stepFunctionModules
    ].validate(name, stepFunctionOptions);
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
  // Zero pipeline metrics.
  pipelineEvents.inc({ flow: "in" }, 0);
  pipelineEvents.inc({ flow: "out" }, 0);
  deadEvents.set(0);
  // Create the input channel.
  const [inputName, inputOptions] = Object.entries(template.input)[0];
  const [inputChannel, inputEnded] = inputModules[
    inputName as keyof typeof inputModules
  ].make(template.name, signature, inputOptions);
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
    const [stepFunctionName, stepFunctionOptions] = Object.entries(
      definition[functionMode] as StepFunctionTemplate
    )[0];
    const fn = await stepFunctionModules[
      stepFunctionName as keyof typeof stepFunctionModules
    ].make(template.name, signature, name, stepFunctionOptions);
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
