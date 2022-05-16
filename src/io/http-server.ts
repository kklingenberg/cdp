import { Server } from "http";
import Koa from "koa";
import {
  HTTP_SERVER_LISTEN_ADDRESS,
  HTTP_SERVER_LISTEN_BACKLOG,
} from "../conf";
import { makeLogger } from "../log";

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
 * A server is built from a single handler. The server listens for
 * requests at the specified port.
 *
 * @param port The TCP port used to listen for requests.
 * @param handler The function to use when receiving requests.
 * @returns An HTTP server instance.
 */
export const makeHTTPServer = (
  port: number,
  handler: (ctx: Koa.Context) => Promise<void>
): HTTPServer => {
  const app = new Koa({ proxy: true });
  let notifyClosed: () => void;
  const closed: Promise<void> = new Promise((resolve) => {
    notifyClosed = resolve;
  });
  const server = app
    .use(handler)
    .listen(
      port,
      HTTP_SERVER_LISTEN_ADDRESS,
      HTTP_SERVER_LISTEN_BACKLOG,
      () => {
        logger.info(
          "Started listening for requests at " +
            `${HTTP_SERVER_LISTEN_ADDRESS}:${port}`
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
