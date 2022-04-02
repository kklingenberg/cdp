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
 * Verifies that the given pipeline is proper. Throws an error if it
 * isn't.
 *
 * The checks performed are four:
 * - That no step has a name equal to the input alias.
 * - That every step has a unique name within the pipeline.
 * - That no step has dependencies that don't refer to another step or
 *   are the input alias.
 * - That the graph formed by the dependency edges doesn't have
 *   cycles.
 * Any failure to meet those restrictions is reported with an
 * explanation message in the thrown error's message property.
 *
 * @param pipeline The pipeline to check.
 */
export const validate = (pipeline: Pipeline): void => {
  if (pipeline.steps.some(({ name }) => name === INPUT_ALIAS)) {
    throw new Error(
      `at least one pipeline step is using the reserved name '${INPUT_ALIAS}'`
    );
  }
  const stepMap: Map<string, string[]> = new Map(
    pipeline.steps.map((step) => [step.name, step.after])
  );
  if (stepMap.size < pipeline.steps.length) {
    throw new Error("the pipeline step names are not unique");
  }
  stepMap.set(INPUT_ALIAS, []);
  for (const step of pipeline.steps) {
    for (const stepDependency of step.after) {
      if (!stepMap.has(stepDependency)) {
        throw new Error(
          `the pipeline step '${step.name}' ` +
            `has a dangling dependency reference '${stepDependency}'`
        );
      }
    }
  }
  const checkedSteps: Set<string> = new Set();
  const check = (step: string, tail: string[]): void => {
    if (checkedSteps.has(step)) {
      return;
    }
    if (tail.includes(step)) {
      throw new Error(
        `the pipeline steps form a dependency cycle: ${tail.join(
          " --> "
        )} --> ${step}`
      );
    }
    const dependencies = stepMap.get(step) ?? [];
    for (const dependentStep of dependencies) {
      check(dependentStep, [...tail, step]);
    }
    checkedSteps.add(step);
  };
  for (const { name } of pipeline.steps) {
    check(name, []);
  }
};

/**
 * Runs a pipeline. Returns a pair containing the promise to await for
 * the pipeline to finish, and a function that can be called to finish
 * it and clean resources. If the pipeline contains an improper DAG
 * (e.g. with cycles or dangling references), this procedure throws an
 * error.
 *
 * @param pipeline The pipeline to run.
 * @returns A promise yielding a pair of the pipeline promise and a
 * finishing function, that schedules the end of the pipeline.
 */
export const run = async (
  pipeline: Pipeline
): Promise<[Promise<void>, () => Promise<void>]> => {
  // Ensure the pipeline is proper.
  validate(pipeline);
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
