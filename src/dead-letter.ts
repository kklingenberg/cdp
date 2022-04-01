import { Event } from "./event";

/**
 * A procedure that does something useful with events that couldn't be
 * processed for whatever reason.
 */
export const handler = async (events: Event[]): Promise<void> => {
  // TODO do something with dead-letters.
};
