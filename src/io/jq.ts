import { spawn, ChildProcess } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { Channel } from "../async-queue";
import { PATH } from "../conf";
import { parse } from "./read-stream";

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
 * Wraps a jq expression so that execution failures don't crash the jq
 * process.
 */
const wrapJqProgram = (program: string): string => `try (${program})`;

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
export const makeChannel = async (
  program: string
): Promise<Channel<unknown, unknown>> => {
  const path = getJqPath();
  if (path === null) {
    throw new Error(
      "jq executable couldn't be found; check your PATH variable"
    );
  }
  const child = spawn(path, ["-cM", "--unbuffered", wrapJqProgram(program)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let onSpawned: (x: null) => void;
  let onError: (err: Error) => void;
  const precondition: Promise<null> = new Promise((resolve, reject) => {
    onSpawned = resolve;
    onError = reject;
  });
  child.on("spawn", () => {
    if (typeof child.pid === "number") {
      instances.set(child.pid, child);
      onSpawned(null);
    } else {
      onError(new Error("jq instance didn't receive a pid"));
    }
  });
  child.on("error", (err) => {
    onError(err);
  });
  await precondition;
  const send = (...values: unknown[]): void => {
    values.forEach((value) => {
      child.stdin.write(JSON.stringify(value) + "\n");
    });
  };
  return { send, receive: parse(child.stdout) };
};
