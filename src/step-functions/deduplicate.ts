import { Channel, AsyncQueue, flatMap } from "../async-queue";
import { getSignature } from "../utils";
import { Event } from "../event";

/**
 * Options for this function.
 */
export type DeduplicateFunctionOptions = {
  ["consider-name"]?: boolean;
  ["consider-data"]?: boolean;
  ["consider-trace"]?: boolean;
} | null;

/**
 * An ajv schema for the options.
 */
export const optionsSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        "consider-name": { type: "boolean" },
        "consider-data": { type: "boolean" },
        "consider-trace": { type: "boolean" },
      },
      additionalProperties: false,
      required: [],
    },
    { type: "null" },
  ],
};

/**
 * Validate deduplcate options, after they've been checked by the ajv
 * schema.
 *
 * @param name The name of the step this function belongs to.
 * @param options The options to validate.
 */
export const validate = (): void => {
  // Nothing needs to be validated.
};

/**
 * Remove duplicate events from the given vector. The duplicate events
 * removed are never the first ones encountered for each event
 * identity.
 *
 * @param keyFn Async function that produces event identities for
 * deduplication.
 * @param events Vector of events to remove duplicates from.
 * @returns A promise that resolves to a new vector of events.
 */
const deduplicate = async (
  keyFn: (e: Event) => Promise<string>,
  events: Event[]
): Promise<Event[]> => {
  const signatures = new Set<string>();
  const signed = await Promise.all(
    events.map((e) => keyFn(e).then((signature) => ({ e, signature })))
  );
  return signed
    .filter(({ signature }) => {
      if (signatures.has(signature)) {
        return false;
      }
      signatures.add(signature);
      return true;
    })
    .map(({ e }) => e);
};

/**
 * Function that removes event duplicates in each batch.
 *
 * @param pipelineName The name of the pipeline.
 * @param pipelineSignature The signature of the pipeline.
 * @param stepName The name of the step this function belongs to.
 * @param options The options that indicate how to deduplicate
 * events.
 * @returns A channel that removes event duplicates.
 */
export const make = async (
  /* eslint-disable @typescript-eslint/no-unused-vars */
  pipelineName: string,
  pipelineSignature: string,
  /* eslint-enable @typescript-eslint/no-unused-vars */
  stepName: string,
  options: DeduplicateFunctionOptions
): Promise<Channel<Event[], Event>> => {
  const queue = new AsyncQueue<Event[]>(`step.${stepName}.deduplicate`);
  const key = [
    options?.["consider-name"] ?? true ? "1" : "0",
    options?.["consider-data"] ?? true ? "1" : "0",
    options?.["consider-trace"] ?? false ? "1" : "0",
  ].join("");
  let keyFn: (e: Event) => Promise<string>;
  switch (key) {
    case "000":
      keyFn = async () => "1"; // Constant key: all events are considered equal.
      break;
    case "001":
      keyFn = (e: Event) => getSignature(e.trace);
      break;
    case "010":
      keyFn = (e: Event) => getSignature(e.data);
      break;
    case "011":
      keyFn = (e: Event) => getSignature(e.data, e.trace);
      break;
    case "100":
      keyFn = async (e: Event) => e.name;
      break;
    case "101":
      keyFn = (e: Event) => getSignature(e.name, e.trace);
      break;
    case "110":
      keyFn = (e: Event) => getSignature(e.name, e.data);
      break;
    case "111":
    default:
      keyFn = (e: Event) => getSignature(e.name, e.data, e.trace);
      break;
  }
  return flatMap(
    (events: Event[]) => deduplicate(keyFn, events),
    queue.asChannel()
  );
};
