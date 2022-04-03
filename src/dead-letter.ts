import { Event } from "./event";
import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("dead-letter");

/**
 * A procedure that does something useful with events that couldn't be
 * processed for whatever reason.
 */
export const handler = async (events: Event[]): Promise<void> => {
  // TODO do something with dead-letters.
  logger.error("Events that didn't reach the end of the pipeline:");
  for (const event of events) {
    console.error(JSON.stringify(event));
  }
};
