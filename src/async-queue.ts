import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("async-queue");

/**
 * A channel is a thing that an agent can use to communicate with
 * another agent.
 */
export interface Channel<SendType, ReceiveType> {
  send: (...values: SendType[]) => void;
  receive: AsyncGenerator<ReceiveType>;
}

/**
 * A queue class that resolves a shift() call only when there's
 * elements in the queue.
 */
export class AsyncQueue<Type> {
  /**
   * The data in the queue.
   */
  data: Type[] = [];

  /**
   * The queue's closed status.
   */
  closed = false;

  /**
   * The promise acting as a lock for the shift operation.
   */
  lock: Promise<void>;

  /**
   * The lock releasing procedure.
   */
  releaseLock: () => void = () => {
    throw new Error("releaseLock is not properly initialized");
  };

  /**
   * A promise that resolves once the queue is closed and empty.
   */
  drain: Promise<void>;

  /**
   * Resolves the drain promise.
   */
  notifyDrained: () => void = () => {
    throw new Error("notifyDrained is not properly initialized");
  };

  /**
   * Asynchronously iterate over this queue's elements.
   */
  iterator: () => AsyncGenerator<Type>;

  constructor() {
    this.lock = new Promise((resolve) => {
      this.releaseLock = resolve;
    });
    this.drain = new Promise((resolve) => {
      this.notifyDrained = resolve;
    });
    this.iterator = async function* () {
      while (true) {
        try {
          yield await this.shift();
        } catch (err) {
          break;
        }
      }
    };
  }

  /**
   * Push a single value to the end of the queue.
   */
  push(value: Type): boolean {
    if (this.closed) {
      logger.warn("push() attempted on a closed queue");
      return false;
    }
    this.data.push(value);
    this.releaseLock();
    return true;
  }

  /**
   * A queue can be closed to prevent it from blocking, or receiving
   * additional pushes. A closed queue will keep yielding elements if
   * it's non-empty, though.
   */
  close(): void {
    this.closed = true;
    this.releaseLock();
    if (this.data.length === 0) {
      this.notifyDrained();
    }
  }

  /**
   * Shift a single value from the start of the queue. Resolves only
   * when there's at least one value to shift, or the queue is closed.
   */
  async shift(): Promise<Type> {
    await this.lock;
    if (this.data.length === 0) {
      throw new Error("shift() attempted on an empty closed queue");
    }
    const value = this.data.shift() as Type;
    if (this.data.length === 0 && !this.closed) {
      this.lock = new Promise((resolve) => {
        this.releaseLock = resolve;
      });
    } else if (this.data.length === 0 && this.closed) {
      this.notifyDrained();
    }
    return value;
  }

  /**
   * Return a channel representation for this queue.
   */
  asChannel(): Channel<Type, Type> {
    return {
      send: (...values) => values.forEach((v) => this.push(v)),
      receive: this.iterator(),
    };
  }
}
