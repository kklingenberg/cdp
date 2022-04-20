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
  send: (...values: SendType[]) => boolean;
  receive: AsyncGenerator<ReceiveType>;
  close: () => Promise<void>;
}

/**
 * A catalog of active queues, used for monitoring.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const activeQueues: Set<AsyncQueue<any>> = new Set();
/* eslint-enable @typescript-eslint/no-explicit-any */

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
    activeQueues.add(this);
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
      activeQueues.delete(this);
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
      activeQueues.delete(this);
    }
    return value;
  }

  /**
   * Return a channel representation for this queue.
   */
  asChannel(): Channel<Type, Type> {
    return {
      send: (...values) =>
        values.map((v) => this.push(v)).every((result) => result),
      receive: this.iterator(),
      close: async () => {
        this.close();
        await this.drain;
      },
    };
  }

  /**
   * Return a string representation of this queue.
   */
  toString(): string {
    return `AsyncQueue<closed=${this.closed}, items=${this.data.length}>`;
  }
}

/**
 * Transforms a channel into another channel through a mapping
 * function.
 *
 * @param fn The function that transforms each received element.
 * @param channel The channel to transform.
 * @returns The transformed channel.
 */
export const flatMap = <A, B, C>(
  fn: (x: B) => Promise<C[]>,
  channel: Channel<A, B>
): Channel<A, C> => {
  let notifyFinished: () => void;
  const receiverFinished: Promise<void> = new Promise((resolve) => {
    notifyFinished = resolve;
  });
  async function* receiver() {
    for await (const b of channel.receive) {
      for (const c of await fn(b)) {
        yield c;
      }
    }
    notifyFinished();
  }
  return {
    send: channel.send,
    receive: receiver(),
    close: async () => {
      await channel.close();
      await receiverFinished;
    },
  };
};

/**
 * Composes channels as if using the function composition
 * combinator: compose(f, g)(x) = f(g(x))
 *
 * @param c1 The channel that receives data from the other channel.
 * @param c2 The channel that sends data to the other channel.
 * @returns The resulting channel.
 */
export const compose = <A, B, C>(
  c1: Channel<B, C>,
  c2: Channel<A, B>
): Channel<A, C> => {
  async function* composed() {
    const eventSlice: [
      Promise<{ x: IteratorResult<B | C>; yields: boolean }> | null,
      Promise<{ x: IteratorResult<B | C>; yields: boolean }> | null
    ] = [
      c1.receive.next().then((x) => ({ x, yields: true })),
      c2.receive.next().then((x) => ({ x, yields: false })),
    ];
    while (eventSlice[0] !== null || eventSlice[1] !== null) {
      const {
        x: { done, value },
        yields,
      } = await Promise.race(
        eventSlice.filter((p) => p !== null) as Promise<{
          x: IteratorResult<B | C>;
          yields: boolean;
        }>[]
      );
      if (done) {
        eventSlice[yields ? 0 : 1] = null;
      } else {
        eventSlice[yields ? 0 : 1] = (yields ? c1 : c2).receive
          .next()
          .then((x) => ({ x, yields }));
        if (yields) {
          yield value;
        } else {
          c1.send(value);
        }
      }
    }
  }
  return {
    send: c2.send.bind(c2),
    receive: composed(),
    close: async () => {
      await c2.close();
      await c1.close();
    },
  };
};
