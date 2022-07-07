import { spawn, ChildProcess } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { Readable } from "stream";
import { AsyncQueue, Channel } from "../async-queue";
import { PATH } from "../conf";
import { parseJson } from "./read-stream";

/**
 * Minimum options passed to Processor#makeChannel.
 */
export interface ProcessorOptions {
  parse?: (stream: Readable, limit?: number) => AsyncGenerator<unknown>;
}

/**
 * Instantiates a usable communication channel with a JSON processor
 * such as jq.
 */
export class Processor<Options extends ProcessorOptions = ProcessorOptions> {
  /**
   * The name of the executable program that processes JSON streams.
   */
  program: string;

  /**
   * The arguments passed to the spawn constructor.
   */
  programArgs: (code: string, options?: Options) => string[];

  /**
   * The absolute path for the executable.
   */
  path: string | null;

  /**
   * Global book-keeping for spawned processes.
   */
  instances: Map<number, ChildProcess>;

  constructor(
    program: string,
    programArgs: (code: string, options?: Options) => string[],
    path: string | null = null
  ) {
    this.program = program;
    this.programArgs = programArgs;
    this.path = path;
    this.instances = new Map();
  }

  /**
   * Attempts to locate the absolute path of the executable.
   *
   * @returns The path or `null`.
   */
  getPath(): string | null {
    if (this.path !== null) {
      return this.path;
    }
    this.path =
      PATH.map((p) => p + "/" + this.program)
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
    return this.path;
  }

  /**
   * Close the spawned instances by sending SIGTERMs to them.
   */
  closeInstances(): void {
    const killed = [];
    for (const [pid, instance] of this.instances) {
      if (instance.kill()) {
        killed.push(pid);
      }
    }
    for (const killedPid of killed) {
      this.instances.delete(killedPid);
    }
  }

  /**
   * Checks the health of the current state. A healthy status is one
   * where all of the spawned processes are still running.
   *
   * @returns A boolean indicating the health status.
   */
  isHealthy(): boolean {
    return Array.from(this.instances.values()).every(
      (instance) => instance.exitCode === null && instance.signalCode === null
    );
  }

  /**
   * Establishes a connection to a fresh jq process, communicating
   * with JSON-encoded values. Returns a channel: a structure with a
   * send function that receives a list of JSON-encodable values and
   * sends them to the jq program, and an async generator that will
   * emit the transformed values emitted by jq.
   *
   * @param code The jq program to use.
   * @returns A promise yielding a channel.
   */
  async makeChannel<T>(
    code: string,
    options?: Options
  ): Promise<Channel<T, unknown>> {
    const path = this.getPath();
    if (path === null) {
      throw new Error(
        `${this.program} executable couldn't be found; check your PATH variable`
      );
    }
    const child = spawn(path, this.programArgs(code, options), {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let onSpawned: () => void;
    let onError: (err: Error) => void;
    const precondition: Promise<void> = new Promise((resolve, reject) => {
      onSpawned = resolve;
      onError = reject;
    });
    child.on("spawn", () => {
      if (typeof child.pid === "number") {
        this.instances.set(child.pid, child);
        onSpawned();
      } else {
        onError(new Error(`${this.program} instance didn't receive a pid`));
      }
    });
    child.on("error", (err) => {
      onError(err);
    });
    let closedIndependently = false;
    child.stdin.on("close", () => {
      closedIndependently = true;
    });
    const parseStream = options?.parse ?? parseJson;
    let notifyEnded: () => void;
    const ended: Promise<void> = new Promise((resolve) => {
      notifyEnded = resolve;
    });
    async function* receiver() {
      for await (const result of parseStream(child.stdout)) {
        yield result;
      }
      notifyEnded();
    }
    const receive = receiver();
    await precondition;

    const bufferChannel: Channel<T, T> = new AsyncQueue<T>(
      `io.${this.program}.buffer`
    ).asChannel();
    const feedEnded: Promise<void> = (async () => {
      for await (const value of bufferChannel.receive) {
        if (closedIndependently) {
          continue;
        }
        const flushed = child.stdin.write(JSON.stringify(value) + "\n");
        if (!flushed && !closedIndependently) {
          await Promise.race([
            new Promise((resolve) => child.stdin.once("drain", resolve)),
            new Promise((resolve) => child.stdin.once("close", resolve)),
          ]);
        }
      }
    })();
    return {
      send: (...items: T[]) => bufferChannel.send(...items),
      receive,
      close: async () => {
        await bufferChannel.close();
        await feedEnded;
        child.stdin.end();
        await ended;
        if (child.kill() && typeof child.pid !== "undefined") {
          this.instances.delete(child.pid);
        }
      },
    };
  }
}
