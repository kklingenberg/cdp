import { Channel, compose } from "./async-queue";
import { Event } from "./event";
import { Pattern } from "./pattern";
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
 * Build a windowing channel that accumulates events in windows of the
 * configured size before forwarding them to the processing function.
 *
 * @param options The step options that also describe the windowing
 * procedure.
 * @param send A shortcut procedure for events that are to be
 * 'passed'.
 * @returns A channel that acts as a windowing (i.e. grouping)
 * function.
 */
const makeWindowingChannel = (
  options: StepOptions,
  send: (...events: Event[]) => void
): Channel<Event, Event[]> => {
  // TODO implement this
  throw new Error("not implemented");
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
export const make = (
  options: StepOptions,
  fn: Channel<Event[], Event>
): StepFactory => {
  return async (send) => {
    const windowingChannel = makeWindowingChannel(options, send);
    const channel = compose(fn, windowingChannel);
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
    return channel;
  };
};
