import {
  DEAD_LETTER_TARGET,
  DEAD_LETTER_TARGET_METHOD,
  DEAD_LETTER_TARGET_HEADERS,
} from "./conf";
import { Event } from "./event";
import { sendEvents } from "./io/http-client";
import { makeLogger } from "./log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("dead-letter");

/**
 * A procedure that does something useful with events that couldn't be
 * processed for whatever reason.
 */
export const handler = async (events: Event[]): Promise<void> => {
  logger.error("Events that couldn't reach the end of the pipeline:");
  for (const event of events) {
    console.error(JSON.stringify(event));
  }
  if ((DEAD_LETTER_TARGET?.length ?? 0) > 0) {
    await sendEvents(
      events,
      DEAD_LETTER_TARGET as string,
      DEAD_LETTER_TARGET_METHOD,
      DEAD_LETTER_TARGET_HEADERS
    );
  }
};
