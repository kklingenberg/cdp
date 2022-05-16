import Koa from "koa";
import client from "prom-client";
import { activeQueues } from "./async-queue";
import {
  METRICS_EXPOSITION_PORT,
  METRICS_EXPOSITION_PATH,
  METRICS_NAME_PREFIX,
} from "./conf";
import { makeLogger } from "./log";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("metrics");

// Collect metrics provided by the client library.
// Source: https://github.com/siimon/prom-client#default-metrics
client.collectDefaultMetrics();

/**
 * Tracks the count of events entering and leaving a pipeline.
 */
export const pipelineEvents = new client.Counter({
  name: `${METRICS_NAME_PREFIX}pipeline_events_total`,
  help: "The count of events flowing in and out of a pipeline.",
  labelNames: ["flow"] as const,
});

/**
 * Tracks the count of events entering and leaving a pipeline step.
 */
export const stepEvents = new client.Counter({
  name: `${METRICS_NAME_PREFIX}step_events_total`,
  help: "The count of events flowing in and out of a pipeline step.",
  labelNames: ["step", "flow"] as const,
});

/**
 * Tracks the count of queued events in any queue used for a pipeline
 * operation.
 */
export const queuedEvents = new client.Gauge({
  name: `${METRICS_NAME_PREFIX}queued_events`,
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
  name: `${METRICS_NAME_PREFIX}dead_events`,
  help: "The count of dead events in a pipeline.",
});

/**
 * Source:
 * https://github.com/prometheus/docs/blob/main/content/docs/instrumenting/exposition_formats.md
 */
const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

/**
 * Expose metrics using an HTTP server.
 *
 * @returns A procedure that finishes exposition.
 */
export const startExposingMetrics = (): (() => Promise<void>) => {
  if (METRICS_EXPOSITION_PATH.length === 0) {
    return () => Promise.resolve();
  }
  const server = new Koa()
    .use(async (ctx) => {
      if (
        ctx.request.method === "GET" &&
        ctx.request.path === METRICS_EXPOSITION_PATH
      ) {
        logger.debug("Generating metrics snapshot");
        ctx.body = await client.register.metrics();
        ctx.type = METRICS_CONTENT_TYPE;
      } else {
        logger.info(
          "Received unrecognized request:",
          ctx.request.method,
          ctx.request.path
        );
        ctx.status = 404;
      }
    })
    .listen(METRICS_EXPOSITION_PORT, "0.0.0.0", () => {
      logger.info(
        "Started exposing metrics at " +
          `port ${METRICS_EXPOSITION_PORT} and path ${METRICS_EXPOSITION_PATH}`
      );
    });
  return () =>
    new Promise((resolve) =>
      server.close(() => {
        logger.info("Finished metrics exposition");
        resolve();
      })
    );
};
