import client from "prom-client";
import { activeQueues } from "./async-queue";
import { METRICS_PREFIX } from "./conf";

// Collect metrics provided by the client library.
// Source: https://github.com/siimon/prom-client#default-metrics
client.collectDefaultMetrics();

/**
 * Tracks the count of events entering and leaving a pipeline.
 */
export const pipelineEvents = new client.Counter({
  name: `${METRICS_PREFIX}pipeline_events_total`,
  help: "The count of events flowing in and out of a pipeline.",
  labelNames: ["flow"] as const,
});

/**
 * Tracks the count of events entering and leaving a pipeline step.
 */
export const stepEvents = new client.Counter({
  name: `${METRICS_PREFIX}step_events_total`,
  help: "The count of events flowing in and out of a pipeline step.",
  labelNames: ["step", "flow"] as const,
});

/**
 * Tracks the count of queued events in any queue used for a pipeline
 * operation.
 */
export const queuedEvents = new client.Gauge({
  name: `${METRICS_PREFIX}queued_events`,
  help: "The count of queued events anywhere in a pipeline.",
  collect() {
    this.set(
      Array.from(activeQueues)
        .map((queue) => queue.data.length)
        .reduce((a, b) => a + b, 0)
    );
  },
});

/**
 * Tracks the count of dead events accumulated during a pipeline
 * operation.
 */
export const deadEvents = new client.Gauge({
  name: `${METRICS_PREFIX}dead_events`,
  help: "The count of dead events in a pipeline.",
});
