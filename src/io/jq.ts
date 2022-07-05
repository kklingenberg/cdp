import { spawn, ChildProcess } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { Readable } from "stream";
import { AsyncQueue, Channel } from "../async-queue";
import { PATH } from "../conf";
import { parseJson } from "./read-stream";

/**
 * Attempts to locate the absolute path of the jq executable.
 *
 * @returns The path or `null`.
 */
const getJqPath: () => string | null = (() => {
  let cachedPath: string | null = null;
  return () => {
    if (cachedPath !== null) {
      return cachedPath;
    }
    cachedPath =
      PATH.map((p) => p + "/jq")
        .map((p) => ({ p, stat: statSync(p, { throwIfNoEntry: false }) }))
        .filter(
          ({ stat }) => typeof stat !== "undefined" && !stat.isDirectory()
        )
        .filter(({ p }) => {
          try {
            accessSync(p, constants.X_OK);
            return true;
          } catch (err) {
            return false;
          }
        })[0]?.p ?? null;
    return cachedPath;
  };
})();

/**
 * Global book-keeping for spawned processes.
 */
const instances: Map<number, ChildProcess> = new Map();

/**
 * Close the spawned instances by sending SIGTERMs to them.
 */
export const closeInstances = (): void => {
  const killed = [];
  for (const [pid, instance] of instances) {
    if (instance.kill()) {
      killed.push(pid);
    }
  }
  for (const killedPid of killed) {
    instances.delete(killedPid);
  }
};

/**
 * Checks the health of the current state. A healthy status is one
 * where all of the spawned processes are still running.
 *
 * @returns A boolean indicating the health status.
 */
export const isHealthy = (): boolean =>
  Array.from(instances.values()).every(
    (instance) => instance.exitCode === null && instance.signalCode === null
  );

/**
 * Wraps a jq expression so that execution failures don't crash the jq
 * process.
 */
const wrapJqProgram = (program: string, prelude?: string): string =>
  `${prelude ?? ""}\ntry (${program})`;

/**
 * Options used to alter a jq channel's behaviour.
 */
interface ChannelOptions {
  parse?: (stream: Readable, limit?: number) => AsyncGenerator<unknown>;
  prelude?: string;
}

/**
 * Establishes a connection to a fresh jq process, communicating with
 * JSON-encoded values. Returns a channel: a structure with a send
 * function that receives a list of JSON-encodable values and sends
 * them to the jq program, and an async generator that will emit the
 * transformed values emitted by jq.
 *
 * @param program The jq program to use.
 * @returns A promise yielding a channel.
 */
export const makeChannel = async <T>(
  program: string,
  options?: ChannelOptions
): Promise<Channel<T, unknown>> => {
  const path = getJqPath();
  if (path === null) {
    throw new Error(
      "jq executable couldn't be found; check your PATH variable"
    );
  }
  const child = spawn(
    path,
    ["-cM", "--unbuffered", wrapJqProgram(program, options?.prelude)],
    {
      stdio: ["pipe", "pipe", "inherit"],
    }
  );
  let onSpawned: () => void;
  let onError: (err: Error) => void;
  const precondition: Promise<void> = new Promise((resolve, reject) => {
    onSpawned = resolve;
    onError = reject;
  });
  child.on("spawn", () => {
    if (typeof child.pid === "number") {
      instances.set(child.pid, child);
      onSpawned();
    } else {
      onError(new Error("jq instance didn't receive a pid"));
    }
  });
  child.on("error", (err) => {
    onError(err);
  });
  await precondition;
  const parseStream = options?.parse ?? parseJson;
  const bufferChannel: Channel<T, T> = new AsyncQueue<T>(
    "io.jq.buffer"
  ).asChannel();
  const feedEnded: Promise<void> = (async () => {
    for await (const value of bufferChannel.receive) {
      const flushed = child.stdin.write(JSON.stringify(value) + "\n");
      if (!flushed) {
        await new Promise((resolve) => child.stdin.once("drain", resolve));
      }
    }
  })();
  let notifyEnded: () => void;
  const ended: Promise<void> = new Promise((resolve) => {
    notifyEnded = resolve;
  });
  async function* receive() {
    for await (const result of parseStream(child.stdout)) {
      yield result;
    }
    notifyEnded();
  }
  return {
    send: bufferChannel.send.bind(bufferChannel),
    receive: receive(),
    close: async () => {
      await bufferChannel.close();
      await feedEnded;
      child.stdin.end();
      await ended;
      if (child.kill() && typeof child.pid !== "undefined") {
        instances.delete(child.pid);
      }
    },
  };
};
