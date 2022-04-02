import { Channel } from "./async-queue";
import { ajv, getSignature, makeLogger } from "./utils";
import { isValidEventName } from "./pattern";

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
const validateSerializedEvent = ajv.compile(serializedEventSchema);

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
   * A weak event's identity, with high chances of being unique in
   * small pools of events of similar ages, within a single pipeline.
   */
  signature: string;

  constructor(
    name: string,
    data: unknown,
    trace: TracePoint[],
    timestamp: number,
    signature: string
  ) {
    this.name = name;
    this.data = data;
    this.trace = trace;
    this.timestamp = timestamp;
    this.signature = signature;
  }

  toJSON(): SerializedEvent {
    return {
      n: this.name,
      d: this.data,
      t: this.trace,
    };
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
  const signature = await getSignature(name, data, trace);
  return new Event(name, data, trace, timestamp, signature);
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
 * Validate an event that's **new**, i.e. was captured by an input
 * form. Throws an error if the event is not valid.
 *
 * @param raw An event to validate.
 */
const validateNewRawEvent = (raw: unknown): void => {
  if (!validateSerializedEvent(raw)) {
    throw new Error(
      validateSerializedEvent.errors
        ?.map((error) => error.message)
        .join("; ") ?? "invalid new event"
    );
  }
  const event = raw as SerializedEvent;
  if (!isValidEventName(event.n)) {
    throw new Error(`event name '${event.n}' is invalid`);
  }
};

/**
 * Validate an event that's **old**, i.e. was generated by a step
 * function. Throws an error if the event is not valid.
 *
 * @param raw An event to validate.
 */
const validateOldRawEvent = (raw: unknown): void => {
  if (!validateSerializedEvent(raw)) {
    throw new Error(
      validateSerializedEvent.errors
        ?.map((error) => error.message)
        .join("; ") ?? "invalid old event"
    );
  }
  const event = raw as SerializedEvent;
  if (!isValidEventName(event.n)) {
    throw new Error(`event name '${event.n}' is invalid`);
  }
  if ((event.t?.length ?? 0) < 1) {
    throw new Error("old event didn't contain a non-empty trace");
  }
};

/**
 * Builds a parser for **new events**, which are events that haven't
 * stemmed from the current pipeline and were captured by the input
 * form. As such, they will always receive a new trace point.
 *
 * @param timestamp The unix timestamp to attach to the trace point.
 * @param pipelineName The name of the current pipeline.
 * @param pipelineSignature The signature of the current pipeline.
 * @returns A function that takes raw values and returns an
 * Event-yielding promise.
 */
export const makeNewEventParser =
  (
    timestamp: number,
    pipelineName: string,
    pipelineSignature: string
  ): ((raw: unknown) => Promise<Event>) =>
  (raw: unknown): Promise<Event> => {
    validateNewRawEvent(raw);
    const rawValid = raw as SerializedEvent;
    return make(rawValid.n, rawValid.d, [
      ...(rawValid.t ?? []),
      { i: timestamp, p: pipelineName, h: pipelineSignature },
    ]);
  };

/**
 * Builds a parser for **old events**, which are events that have
 * stemmed from the current pipeline, i.e. they were created by some
 * step function. As such, they don't receive additional trace points.
 *
 * @returns A function that takes raw values and returns an
 * Event-yielding promise.
 */
export const makeOldEventParser =
  (): ((raw: unknown) => Promise<Event>) =>
  (raw: unknown): Promise<Event> => {
    validateOldRawEvent(raw);
    const rawValid = raw as SerializedEvent;
    return make(rawValid.n, rawValid.d, rawValid.t ?? []);
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
      logger.warn("Event dropped after", context, ";", new String(err));
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
): Channel<T, Event> => {
  async function* receiver() {
    for await (const raw of channel.receive) {
      for (const event of await parseVector(
        raw,
        parser,
        context ?? "parsing channel"
      )) {
        yield event;
      }
    }
  }
  return { send: channel.send, receive: receiver() };
};