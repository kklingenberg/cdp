import { AsyncQueue, Channel, compose } from "./async-queue";
import { Event } from "./event";
import { Pattern, match } from "./pattern";
import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("step");

/**
 * A step is a channel of events.
 */
export type Step = Channel<Event, Event>;

/**
 * General options for the construction of a step.
 */
export type StepOptions = {
  name: string;
  windowMaxSize: number;
  windowMaxDuration?: number;
  pattern?: Pattern;
  patternMode: "pass" | "drop";
  functionMode: "flatmap" | "reduce";
};

/**
 * Build a matching procedure that determines whether an event is
 * desired according to the given step options, and also forwards it
 * if it's not desired but required to flow elsewhere.
 *
 * @param options The step options that determine the predicate.
 * @param forward The forwarding function.
 * @returns A predicate for events that also forwards the non-passing
 * events if it's appropriate.
 */
const makeMatcher = (
  options: StepOptions,
  forward: (...events: Event[]) => void
): ((event: Event) => boolean) => {
  const sendForward =
    options.patternMode === "pass"
      ? (e: Event) => {
          forward(e);
          return false;
        }
      : () => false;
  return typeof options.pattern === "undefined"
    ? () => true
    : (event: Event) =>
        match(event.name, options.pattern ?? "#") ? true : sendForward(event);
};

/**
 * Build a windowing channel that accumulates events in windows of the
 * configured size before forwarding them to the processing function.
 *
 * @param options The step options that also describe the windowing
 * procedure.
 * @returns A channel that acts as a windowing (i.e. grouping)
 * function.
 */
export const makeWindowingChannel = (
  options: StepOptions
): Channel<Event, Event[]> => {
  const queue = new AsyncQueue<Event[]>();
  const currentGroups: Map<number, Event[]> = new Map();
  let currentGroupIndex = 0;
  const timeWindow =
    options.windowMaxSize <= 1 ? -1 : (options.windowMaxDuration ?? -1) * 1000;
  // This procedure does three things:
  // - It pushes an event to an internal (set of) buffer(s).
  // - It starts a timeout that will forward the buffer after enough
  //   time.
  // - It forwards the buffer(s) if they're 'big enough'.
  // The criterion of whether to use a single buffer or a set of
  // buffers maps on to the function mode. 'flatmap' requires for each
  // event to be at the start of some buffer, thus the flatmap mode
  // uses several concurrent buffers. The 'reduce' mode only requires
  // one, which get's cleared after each forwarding.
  const sendOne = (event: Event): boolean => {
    const newGroup = !currentGroups.has(currentGroupIndex);
    if (newGroup) {
      currentGroups.set(currentGroupIndex, []);
    }
    currentGroups.forEach((g) => g.push(event));
    if (newGroup && timeWindow >= 0) {
      setTimeout(
        (index) => {
          if (currentGroups.has(index)) {
            const timedOutGroup = currentGroups.get(index) as Event[];
            currentGroups.delete(index);
            queue.push(timedOutGroup);
          }
        },
        timeWindow,
        currentGroupIndex
      ).unref();
    }
    if (options.functionMode === "reduce") {
      // In reduce mode, groups are disjoint
    } else {
      // In flatmap mode, groups overlap
      currentGroupIndex++;
    }
    return Array.from(currentGroups)
      .sort(([indexA], [indexB]) => indexA - indexB)
      .map(([index, group]) => {
        if (group.length >= options.windowMaxSize) {
          currentGroups.delete(index);
          return queue.push(group);
        }
        return true;
      })
      .every((pushed) => pushed);
  };
  return {
    send: (...values: Event[]) => values.every((value) => sendOne(value)),
    receive: queue.iterator(),
    close: async () => {
      // Push any incomplete groups.
      Array.from(currentGroups)
        .sort(([indexA], [indexB]) => indexA - indexB)
        .forEach(([index, group]) => {
          currentGroups.delete(index);
          queue.push(group);
        });
      // Then close the queue.
      queue.close();
      await queue.drain;
    },
  };
};

/**
 * A step is a function that bootstraps a step once it's given the
 * forwarding procedure.
 */
export type StepFactory = (send: (...events: Event[]) => void) => Promise<Step>;

/**
 * Builds a step factory, according to options and a preconfigured
 * channel that processes batches of events.
 *
 * @param options The step options.
 * @param fn The channel that does the processing.
 * @returns A step factory.
 */
export const makeWindowed = (
  options: StepOptions,
  fn: Channel<Event[], Event>
): StepFactory => {
  const windowingChannel = makeWindowingChannel(options);
  const channel = compose(fn, windowingChannel);
  return async (send) => {
    const filterOrPass = makeMatcher(options, send);
    const operate = async () => {
      for await (const event of channel.receive) {
        send(event);
      }
    };
    // Start the event processing
    operate().then(
      () => logger.info(`Step ${options.name} finished operation`),
      (err) =>
        logger.warn(
          `Step ${options.name} encountered an error during operation`,
          err
        )
    );
    return {
      ...channel,
      send: (...events: Event[]) =>
        channel.send(...events.filter(filterOrPass)),
    };
  };
};

/**
 * Builds a step factory, according to options and a preconfigured
 * channel that processes single events.
 *
 * @param options The step options.
 * @param fn The channel that does the processing.
 * @returns A step factory.
 */
export const makeStreamlined =
  (options: StepOptions, fn: Channel<Event, Event>): StepFactory =>
  async (send) => {
    const filterOrPass = makeMatcher(options, send);
    const operate = async () => {
      for await (const event of fn.receive) {
        send(event);
      }
    };
    // Start the event processing
    operate().then(
      () => logger.info(`Step ${options.name} finished operation`),
      (err) =>
        logger.warn(
          `Step ${options.name} encountered an error during operation`,
          err
        )
    );
    return {
      ...fn,
      send: (...events: Event[]) => fn.send(...events.filter(filterOrPass)),
    };
  };
