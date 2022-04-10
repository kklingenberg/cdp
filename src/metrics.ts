import client from "prom-client";
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
  labelNames: ["pipeline", "flow"] as const,
});

/**
 * Tracks the count of events entering and leaving a pipeline step.
 */
export const stepEvents = new client.Counter({
  name: `${METRICS_PREFIX}step_events_total`,
  help: "The count of events flowing in and out of a pipeline step.",
  labelNames: ["pipeline", "step", "flow"] as const,
});
