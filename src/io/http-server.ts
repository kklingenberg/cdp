import { Server } from "http";
import Koa from "koa";
import { isHealthy } from "./jq";
import {
  HTTP_SERVER_LISTEN_ADDRESS,
  HTTP_SERVER_LISTEN_BACKLOG,
  HTTP_SERVER_HEALTH_ENDPOINT,
} from "../conf";
import { makeLogger } from "../utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("io/http-server");

/**
 * A server can be asked to be closed, and checked if it's closed.
 */
interface HTTPServer {
  app: Koa<Koa.DefaultState, Koa.DefaultContext>;
  server: Server;
  close: () => Promise<void>;
  closed: Promise<void>;
}

/**
 * A server is built from a single handler. The server then listens
 * for POST requests at the specified endpoint, applies the handler
 * and responds with a token acknowledgement.
 *
 * @param endpoint The endpoint at which to listen for requests.
 * @param port The TCP port used to listen for requests.
 * @param handler The function to use when receiving requests.
 * @returns An HTTP server instance.
 */
export const makeHTTPServer = (
  endpoint: string,
  port: number,
  handler: (ctx: Koa.Context) => Promise<void>
): HTTPServer => {
  const app = new Koa();
  let notifyClosed: () => void;
  const closed: Promise<void> = new Promise((resolve) => {
    notifyClosed = resolve;
  });
  const server = app
    .use(async (ctx) => {
      logger.debug("Received request:", ctx.request.method, ctx.request.path);
      if (ctx.request.method === "POST" && ctx.request.path === endpoint) {
        logger.info("Received events payload:", ctx.request.length, "bytes");
        await handler(ctx);
        ctx.body = null;
      } else if (
        ctx.request.method === "GET" &&
        ctx.request.path === HTTP_SERVER_HEALTH_ENDPOINT
      ) {
        ctx.type = "application/health+json";
        if (isHealthy()) {
          ctx.body = JSON.stringify({ status: "pass" });
        } else {
          logger.warn("Notified unhealthy status");
          ctx.body = JSON.stringify({ status: "fail" });
          ctx.status = 500;
        }
      } else {
        logger.info(
          "Received unrecognized request:",
          ctx.request.method,
          ctx.request.path
        );
        ctx.status = 404;
      }
    })
    .listen(
      port,
      HTTP_SERVER_LISTEN_ADDRESS,
      HTTP_SERVER_LISTEN_BACKLOG,
      () => {
        logger.info(
          "Started listening for events at " +
            `${HTTP_SERVER_LISTEN_ADDRESS}:${port} ` +
            `at endpoint '${endpoint}'`
        );
      }
    );
  return {
    app,
    server,
    close: async () => {
      server.close(() => notifyClosed());
      await closed;
    },
    closed,
  };
};
