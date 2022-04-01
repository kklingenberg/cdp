import { AsyncQueue } from "./async-queue";
import { QUEUE_DRAIN_GRACE_PERIOD } from "./conf";
import * as deadLetter from "./dead-letter";
import { Event } from "./event";
import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("pipeline");

/**
 * A step definition for the purposes of pipeline execution. Step
 * creation nuances are obscured by the factory procedure.
 */
export interface StepDefinition {
  name: string;
  after: string[];
  factory: (send: (...events: Event[]) => void) => Promise<AsyncQueue<Event>>;
}

/**
 * A pipeline definition stripped of anything that's not essential for
 * its execution. It essentially reduces to an initial generator and a
 * DAG of pipeline steps.
 */
export interface Pipeline {
  input: AsyncGenerator<Event>;
  steps: StepDefinition[];
}

/**
 * An alias for the input pseudo-step, so that other steps can declare
 * it as an explicit dependency.
 */
export const INPUT_ALIAS = "$input";

/**
 * Runs a pipeline. Returns a pair containing the promise to await for
 * the pipeline to finish, and a function that can be called to finish
 * it and clean resources. If the given pipeline contains an improper
 * DAG this function behaves incorrectly (e.g. the closing procedure
 * might not terminate). An improper DAG could be one that has cycles
 * in it, or dangling references.
 *
 * @param pipeline The pipeline to run, assumed to be a proper DAG.
 * @returns A promise yielding a pair of the pipeline promise and a
 * finishing function, that schedules the end of the pipeline.
 */
export const run = async (
  pipeline: Pipeline
): Promise<[Promise<void>, () => Promise<void>]> => {
  // Translate steps into integers for lighter event annotations.
  const inputNodeIndex = -1;
  const stepTranslation = new Map(
    pipeline.steps.map(({ name }, index) => [name, index])
  );
  stepTranslation.set(INPUT_ALIAS, inputNodeIndex);
  // Edges in the DAG are built indexing the source node. Thus the
  // pipeline structure needs to be inverted.
  const edges: Map<number, number[]> = new Map(
    pipeline.steps.map((_, index) => [index, []])
  );
  edges.set(inputNodeIndex, []);
  for (const step of pipeline.steps) {
    const stepIndex = stepTranslation.get(step.name) as number;
    for (const previousNodeIndex of step.after.map((name) =>
      stepTranslation.get(name)
    )) {
      (edges.get(previousNodeIndex as number) as number[]).push(stepIndex);
    }
    // Not declaring dependencies is the same as depending on the
    // input.
    if (step.after.length === 0) {
      (edges.get(inputNodeIndex) as number[]).push(stepIndex);
    }
  }
  // The original structure which indexes target nodes is also
  // required for closing up all queues in the least destructive
  // manner possible.
  const reverseEdges: Map<number, number[]> = new Map(
    pipeline.steps.map(({ after }, index) => [
      index,
      after
        .map((name) => stepTranslation.get(name) as number)
        .filter((index) => index !== inputNodeIndex),
    ])
  );
  // Initiate the central bus queue, a dead event list, and all the
  // steps.
  const busQueue = new AsyncQueue<[number, Event]>();
  const deadEvents: Event[] = [];
  const makeSender =
    (index: number) =>
    (...events: Event[]) =>
      events.forEach((event) => {
        if (!busQueue.push([index, event])) {
          deadEvents.push(event);
        }
      });
  const steps: Map<number, AsyncQueue<Event>> = new Map(
    await Promise.all(
      pipeline.steps.map(
        async (step, index) =>
          [index, await step.factory(makeSender(index))] as [
            number,
            AsyncQueue<Event>
          ]
      )
    )
  );
  // Prepare the main promise, as a combination of the input feeding
  // promise and the event-digesting promise.
  const feedInput = async () => {
    for await (const event of pipeline.input) {
      busQueue.push([inputNodeIndex, event]);
    }
  };
  const finishedFeedingInput = feedInput();
  const digestEvents = async () => {
    for await (const [sourceNodeIndex, event] of busQueue.iterator()) {
      const nextNodeIndices = edges.get(sourceNodeIndex) ?? [];
      let sent = true;
      nextNodeIndices.forEach((nodeIndex) => {
        if (!(steps.get(nodeIndex) as AsyncQueue<Event>).push(event)) {
          sent = false;
        }
      });
      if (!sent) {
        deadEvents.push(event);
      }
    }
  };
  // Prepare the closing procedure.
  const close = async () => {
    // Wait for the input to stop flowing.
    await finishedFeedingInput;
    // Sort steps in ascending order of dependency levels, and close
    // the queues in that order.
    const pool: Set<number> = new Set(steps.keys());
    while (pool.size > 0) {
      const toRemove = Array.from(pool).filter((stepIndex) =>
        (reverseEdges.get(stepIndex) as number[]).every((i) => !pool.has(i))
      );
      for (const i of toRemove) {
        const queue = steps.get(i) as AsyncQueue<Event>;
        queue.close();
        await queue.drain;
        pool.delete(i);
      }
      // Give time for remaining events to propagate
      await new Promise((resolve) =>
        setTimeout(resolve, QUEUE_DRAIN_GRACE_PERIOD)
      );
    }
    // Close the bus queue and drain it.
    busQueue.close();
    await busQueue.drain;
  };
  return [
    Promise.all([finishedFeedingInput, digestEvents()]).then(async () => {
      logger.info("Pipeline finished processing events");
      if (deadEvents.length > 0) {
        logger.info("Handling dead events:", deadEvents.length, "events");
        await deadLetter.handler(deadEvents);
      }
    }),
    close,
  ];
};
