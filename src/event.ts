import { Readable } from "stream";
import { Channel, flatMap } from "./async-queue";
import { parseLines, parseJson } from "./io/read-stream";
import { makeLogger } from "./log";
import { isValidEventName } from "./pattern";
import { ajv, compileThrowing } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("event");

/**
 * A tracepoint represents a single point in the history of an event.
 */
export type TracePoint = {
  i: number;
  p: string;
  h: string;
};

/**
 * Provide the type definition as a JSON schema.
 */
const tracePointSchema = {
  type: "object",
  properties: {
    i: { type: "number", minimum: 0 },
    p: { type: "string", minLength: 1 },
    h: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
  required: ["i", "p", "h"],
};

/**
 * A serialized event is an encoded Event with redundancies stripped,
 * and keys reduced for lighter transmissions.
 */
export type SerializedEvent = {
  n: string;
  d?: unknown;
  t?: TracePoint[];
};

/**
 * Provide the type definition as a JSON schema.
 */
const serializedEventSchema = {
  type: "object",
  properties: {
    n: { type: "string" },
    d: {},
    t: { type: "array", items: tracePointSchema },
  },
  additionalProperties: false,
  required: ["n"],
};

/**
 * Validate a serialized event using the schema.
 */
const validateSerializedEvent = compileThrowing(serializedEventSchema);

/**
 * Generate a construction counter value for this event.
 */
const nextCounter: () => number = (() => {
  let currentValue = 0;
  return () => {
    currentValue = (currentValue + 1) % Number.MAX_SAFE_INTEGER;
    return currentValue;
  };
})();

/**
 * An event is the smallest unit of data processable in CDP. It's a
 * wrapper around a variant-typed data packet.
 */
export class Event {
  /**
   * The event's name, most commonly the name of an event series.
   */
  name: string;

  /**
   * The wrapped data. Can be anything JSON-encodable.
   */
  data: unknown;

  /**
   * The trace or history of the event.
   */
  trace: TracePoint[];

  /**
   * The unix timestamp, as a float, representing the event's arrival
   * to the pipeline. Derived events can inherit the timestamp of
   * their parents, or they can generate a new timestamp.
   */
  timestamp: number;

  /**
   * A weak event's identity.
   */
  id: number;

  constructor(
    name: string,
    data: unknown,
    trace: TracePoint[],
    timestamp: number,
    id?: number
  ) {
    this.name = name;
    this.data = data;
    this.trace = trace;
    this.timestamp = timestamp;
    this.id = id ?? nextCounter();
  }

  toJSON(): SerializedEvent {
    return {
      n: this.name,
      d: this.data,
      t: this.trace,
    };
  }

  toString(): string {
    return `Event#${this.id}`;
  }
}

/**
 * Construct an event given a name, the data to wrap, and a trace
 * vector.
 *
 * @param name The event's name.
 * @param data The event's wrapped data.
 * @param trace The event's trace vector.
 * @returns A newly created event.
 */
export const make = async (
  name: string,
  data: unknown,
  trace: TracePoint[]
): Promise<Event> => {
  const timestamp = trace[trace.length - 1].i;
  return new Event(name, data, trace, timestamp);
};

/**
 * A partial event structure, which can be patched on to another
 * event.
 */
export interface PartialEvent {
  name?: string;
  data?: unknown;
  trace?: TracePoint[];
}

/**
 * Construct an new event given an existing one and a set of updates.
 *
 * @param event The existing event to use as a template.
 * @param updates The changes to apply over the template.
 * @returns A newly created event.
 */
export const makeFrom = (
  event: Event,
  updates?: PartialEvent
): Promise<Event> =>
  make(
    updates?.name ?? event.name,
    updates?.data ?? event.data,
    updates?.trace ?? event.trace
  );

/**
 * Validate a raw (i.e. serialized) event. Throws an error if the
 * event is not valid.
 *
 * @param raw An event to validate.
 */
const validateRawEvent = (raw: unknown): void => {
  const event = validateSerializedEvent(raw) as SerializedEvent;
  if (!isValidEventName(event.n)) {
    throw new Error(`event name '${event.n}' is invalid`);
  }
};

/**
 * Provide a global source of time, to be set elsewhere when
 * needed. This is used to mark new events arriving simultaneusly to
 * have the same timestamp.
 */
export const arrivalTimestamp = {
  _value: 0,
  get value() {
    return this._value;
  },
  update() {
    this._value = new Date().getTime() / 1000;
  },
};

/**
 * Builds a parser for **new events**, which are events that haven't
 * stemmed from the current pipeline and were captured by the input
 * form. As such, they will always receive a new trace point.
 *
 * @param pipelineName The name of the current pipeline.
 * @param pipelineSignature The signature of the current pipeline.
 * @returns A function that takes raw values and returns an
 * Event-yielding promise.
 */
export const makeNewEventParser =
  (
    pipelineName: string,
    pipelineSignature: string
  ): ((raw: unknown) => Promise<Event>) =>
  (raw: unknown): Promise<Event> => {
    validateRawEvent(raw);
    const rawValid = raw as SerializedEvent;
    return make(rawValid.n, rawValid.d, [
      ...(rawValid.t ?? []),
      { i: arrivalTimestamp.value, p: pipelineName, h: pipelineSignature },
    ]);
  };

/**
 * Builds a parser for **old events**, which are events that have
 * stemmed from the current pipeline, i.e. they were created by some
 * step function. As such, they don't receive additional trace points
 * unless they're found to have the tracepoint of this pipeline
 * missing, in which case it's added to the end of the trace.
 *
 * @param pipelineName The name of the current pipeline.
 * @param pipelineSignature The signature of the current pipeline.
 * @returns A function that takes raw values and returns an
 * Event-yielding promise.
 */
export const makeOldEventParser =
  (
    pipelineName: string,
    pipelineSignature: string
  ): ((raw: unknown) => Promise<Event>) =>
  (raw: unknown): Promise<Event> => {
    validateRawEvent(raw);
    const rawValid = raw as SerializedEvent;
    const trace = rawValid.t ?? [];
    if (
      !trace.some(({ p, h }) => p === pipelineName && h === pipelineSignature)
    ) {
      trace.push({
        i: new Date().getTime() / 1000,
        p: pipelineName,
        h: pipelineSignature,
      });
    }
    return make(rawValid.n, rawValid.d, trace);
  };

/**
 * Handles a raw value with the given parser, assuming it could be
 * either a raw event, a vector of raw events, or even a nested vector
 * of raw events.
 *
 * @param rawVector The raw value to parse.
 * @param parser The parser to use for individual events extracted.
 * @param context A string that explains where this is happening, in
 * case of errors.
 * @returns A promise that yields a vector of events.
 */
export const parseVector = async (
  rawVector: unknown,
  parser: (raw: unknown) => Promise<Event>,
  context: string
): Promise<Event[]> => {
  if (!Array.isArray(rawVector)) {
    try {
      const event = await parser(rawVector);
      return [event];
    } catch (err) {
      logger.warn(`Event dropped after ${context}; ${err}`);
      return [];
    }
  }
  const events = [];
  for (const entry of rawVector) {
    for (const event of await parseVector(entry, parser, context)) {
      events.push(event);
    }
  }
  return events;
};

/**
 * Applies the given parser to the channel, returning a new channel
 * that produces events.
 *
 * @param channel The channel to apply the parser to.
 * @param parser The parser to use.
 * @param context An informational context for error messages.
 * @returns A new channel that produces events.
 */
export const parseChannel = <T>(
  channel: Channel<T, unknown>,
  parser: (raw: unknown) => Promise<Event>,
  context?: string
): Channel<T, Event> =>
  flatMap(
    (raw: unknown) => parseVector(raw, parser, context ?? "parsing channel"),
    channel
  );

/**
 * A wrapper directive is an instruction to wrap incoming data into an
 * event structure.
 */
export type WrapDirective = string | { name: string; raw?: boolean };

/**
 * Provide the above type definition as a JSON schema.
 */
export const wrapDirectiveSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        raw: { type: "boolean" },
      },
      additionalProperties: false,
      required: ["name"],
    },
  ],
};

/**
 * Validate a wrap directive using the schema.
 */
const validateWrapDirective = ajv.compile(wrapDirectiveSchema);

/**
 * Validate the correctness of a wrap directive.
 *
 * @param wrap The wrap directive that needs validation.
 * @param errorPrefix A prefix used for the error message, emitted in
 * case the wrap directive is not valid.
 * @returns true if it returns.
 */
export const validateWrap = (wrap: unknown, errorPrefix = "wrap"): boolean => {
  if (typeof wrap === "undefined") {
    return true;
  }
  if (!validateWrapDirective(wrap)) {
    throw new Error(
      `${errorPrefix} is not valid: ` +
        ajv.errorsText(validateWrapDirective.errors, { separator: "; " })
    );
  }
  if (typeof wrap === "string" && !isValidEventName(wrap)) {
    throw new Error(
      `${errorPrefix} is not valid: the given event name is not valid`
    );
  }
  if (typeof wrap === "object") {
    const { name } = wrap as { name: string };
    if (!isValidEventName(name)) {
      throw new Error(
        `${errorPrefix} is not valid: the given event name is not valid`
      );
    }
  }
  return true;
};

/**
 * Choose a stream parser based on the wrapping directive.
 *
 * @param wrap The wrapping directive. May be absent.
 * @return A procedure that parses a stream.
 */
export const chooseParser = (
  wrap?: WrapDirective
): ((stream: Readable, limit?: number) => AsyncGenerator<unknown>) =>
  typeof wrap === "string"
    ? parseJson
    : typeof wrap !== "undefined" && wrap.raw
    ? parseLines
    : parseJson;

/**
 * Make en event wrapper: a function that takes any value and envelops
 * it into a serialized event.
 *
 * @param n The name of the event that will be created. If n is not
 * given or undefined, the wrapper does nothing to values.
 * @returns A function that wraps (or not) raw data.
 */
export const makeWrapper = (
  n?: WrapDirective
): ((d: unknown) => SerializedEvent) =>
  typeof n === "string"
    ? (d: unknown): SerializedEvent => ({ n, d })
    : typeof n !== "undefined"
    ? makeWrapper(n.name)
    : (d: unknown): SerializedEvent => d as SerializedEvent;
