import { makeLogger } from "./utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("async-queue");

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
   * Asynchronously iterate over this queue's elements.
   */
  iterator: () => AsyncGenerator<Type>;

  constructor() {
    this.lock = new Promise((resolve) => {
      this.releaseLock = resolve;
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
    }
    return value;
  }
}
