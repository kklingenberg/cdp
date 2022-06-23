import Koa from "koa";
import client from "prom-client";
import { match, P } from "ts-pattern";
import { activeQueues } from "./async-queue";
import {
  METRICS_EXPOSITION_PORT,
  METRICS_EXPOSITION_PATH,
  METRICS_NAME_PREFIX,
  BACKPRESSURE_INTERVAL,
  BACKPRESSURE_RSS,
  BACKPRESSURE_HEAP_TOTAL,
  BACKPRESSURE_HEAP_USED,
  BACKPRESSURE_QUEUED_EVENTS,
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
 * Get a total count of queued events, in all queues.
 *
 * @returns The total count of queued events.
 */
const getQueuedEvents = (): number =>
  Array.from(activeQueues)
    .map((queue) => queue.data.length)
    .reduce((a, b) => a + b, 0);

/**
 * Tracks the count of queued events in any queue used for a pipeline
 * operation.
 */
export const queuedEvents = new client.Gauge({
  name: `${METRICS_NAME_PREFIX}queued_events`,
  help: "The count of queued events anywhere in a pipeline.",
  collect() {
    this.set(getQueuedEvents());
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
 * A global, boxed boolean value that gets updated according to a set
 * of tracked metrics. The value indicates whether input forms should
 * pause ingestion (true), or ingest freely (false).
 */
export const backpressure = (() => {
  let state = false;
  return {
    status() {
      return state;
    },
    update(v: boolean) {
      state = v;
      return this;
    },
  };
})();

/**
 * Tracks the status of the backpressure global flag.
 */
export const backpressureMetric = new client.Gauge({
  name: `${METRICS_NAME_PREFIX}backpressure`,
  help: "Whether the pipeline is signaling backpressure.",
  collect() {
    this.set(backpressure.status() ? 1 : 0);
  },
});

/**
 * Helper to serialize measurement effect procedures, short-circuiting
 * when one returns `true`.
 *
 * @param fns Procedures to compose into one.
 * @returns A single composed procedure that mutates the
 * `backpressure` state.
 */
const sequenceWatchers =
  (fns: (() => boolean)[]): (() => void) =>
  () => {
    for (const fn of fns) {
      if (fn()) {
        backpressure.update(true);
        return;
      }
    }
    backpressure.update(false);
  };

/**
 * Observe the configured metrics and update the backpressure global
 * flag accordingly.
 */
const watchBackpressure = sequenceWatchers([
  match([BACKPRESSURE_RSS, BACKPRESSURE_HEAP_TOTAL, BACKPRESSURE_HEAP_USED])
    .with([null, null, null], () => () => false)
    .with(
      [P.not(null), null, null],
      () => () => process.memoryUsage.rss() >= (BACKPRESSURE_RSS ?? 0)
    )
    .with(P._, () => () => {
      const usage = process.memoryUsage();
      if (BACKPRESSURE_RSS !== null && usage.rss >= BACKPRESSURE_RSS) {
        return true;
      }
      if (
        BACKPRESSURE_HEAP_TOTAL !== null &&
        usage.heapTotal >= BACKPRESSURE_HEAP_TOTAL
      ) {
        return true;
      }
      if (
        BACKPRESSURE_HEAP_USED !== null &&
        usage.heapUsed >= BACKPRESSURE_HEAP_USED
      ) {
        return true;
      }
      return false;
    })
    .exhaustive(),
  BACKPRESSURE_QUEUED_EVENTS !== null
    ? () => getQueuedEvents() >= (BACKPRESSURE_QUEUED_EVENTS ?? 0)
    : () => false,
]);

/**
 * Source:
 * https://github.com/prometheus/docs/blob/main/content/docs/instrumenting/exposition_formats.md
 */
const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

/**
 * Watch and expose metrics using an HTTP server. Also watch for
 * backpressure events and notify them.
 *
 * @returns A procedure that finishes exposition.
 */
export const startExposingMetrics = (): (() => Promise<void>) => {
  const backpressureMeasurements = setInterval(
    watchBackpressure,
    BACKPRESSURE_INTERVAL * 1000
  );
  if (METRICS_EXPOSITION_PATH.length === 0) {
    return async () => clearInterval(backpressureMeasurements);
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
  return () => {
    clearInterval(backpressureMeasurements);
    return new Promise((resolve) =>
      server.close(() => {
        logger.info("Finished metrics exposition");
        resolve();
      })
    );
  };
};
