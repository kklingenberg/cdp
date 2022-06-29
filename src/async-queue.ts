import { makeLogger } from "./log";

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
 * An alternative to plain arrays as queues, with better shift()
 * performance. Credit to: https://github.com/sanori/queue-js
 *
 * queue-js is licensed under Apache-2.0:
 * https://github.com/sanori/queue-js/blob/main/LICENSE
 */
export class Queue<Type> {
  /**
   * The data in the queue, held in two stacks.
   */
  stackForward: Type[] = [];
  stackBackward: Type[] = [];

  /**
   * Push a single value to the end of the queue.
   */
  push(value: Type): void {
    this.stackForward.push(value);
  }

  /**
   * Get a value from the begging of the queue.
   */
  shift(): Type | undefined {
    if (this.stackBackward.length === 0) {
      const t = this.stackBackward;
      this.stackBackward = this.stackForward.reverse();
      this.stackForward = t;
    }
    return this.stackBackward.pop();
  }

  /**
   * Get the total amount of items in the queue.
   */
  get length(): number {
    return this.stackForward.length + this.stackBackward.length;
  }
}

/**
 * A queue class that resolves a shift() call only when there's
 * elements in the queue.
 */
export class AsyncQueue<Type> {
  /**
   * A name useful for debugging.
   */
  name: string;

  /**
   * The data in the queue.
   */
  data: Queue<Type> = new Queue();

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

  constructor(name = "anonymous queue") {
    this.name = name;
    this.lock = new Promise((resolve) => {
      this.releaseLock = resolve;
    });
    this.drain = new Promise((resolve) => {
      this.notifyDrained = resolve;
    });
    this.iterator = async function* () {
      while (true) {
        const [isClosed, value] = await this.#shift();
        if (isClosed) {
          break;
        } else {
          yield value;
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
      logger.warn(`push() attempted on a closed queue: ${this.name}`);
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
   * when there's at least one value to shift, or the queue is
   * closed. Resolves to a pair [isClosed, value].
   */
  async #shift(): Promise<[true, null] | [false, Type]> {
    await this.lock;
    if (this.data.length === 0) {
      return [true, null];
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
    return [false, value];
  }

  /**
   * Shift a single value from the start of the queue. Resolves only
   * when there's at least one value to shift, or the queue is closed.
   */
  async shift(): Promise<Type> {
    const [isClosed, value] = await this.#shift();
    if (isClosed) {
      throw new Error(
        `shift() attempted on an empty closed queue: ${this.name}`
      );
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
    return `AsyncQueue<name=${this.name}, closed=${this.closed}, items=${this.data.length}>`;
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
  let started = false;
  async function* receiver() {
    started = true;
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
      if (started) {
        await receiverFinished;
      }
    },
  };
};

/**
 * Drains a channel, executing a side effect while draining it.
 *
 * @param channel The channel to drain.
 * @param effect The procedure that generates side effects.
 * @param finalEffect An optional procedure that executes side effects
 * after the channel is depleted.
 * @returns A self-draining channel that never produces values.
 */
export const drain = <A, B>(
  channel: Channel<A, B>,
  effect: (value: B) => Promise<void>,
  finalEffect?: () => Promise<void>
): Channel<A, never> => {
  const masked = flatMap(async (value: B) => {
    await effect(value);
    return [];
  }, channel);
  const drained: Promise<void> = masked.receive.next().then(
    finalEffect ??
      (() => {
        // nothing
      })
  );
  return {
    ...masked,
    close: async () => {
      await masked.close();
      await drained;
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
  const masked = drain(
    c2,
    async (value: B) => {
      c1.send(value);
    },
    () => c1.close()
  );
  return {
    ...masked,
    receive: c1.receive,
  };
};
