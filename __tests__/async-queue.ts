import { AsyncQueue } from "../src/async-queue";

test("Shifting from an empty queue blocks", async () => {
  const queue = new AsyncQueue<boolean>();
  const blocked = await Promise.race([
    new Promise((resolve) => setTimeout(resolve, 1, true)),
    queue.shift(),
  ]);
  expect(blocked).toBe(true);
});

test("Shifting from a non-empty queue doesn't block", async () => {
  const queue = new AsyncQueue<boolean>();
  queue.push(false);
  const blocked = await Promise.race([
    new Promise((resolve) => setTimeout(resolve, 1, true)),
    queue.shift(),
  ]);
  expect(blocked).toBe(false);
});

test("A blocked queue can be unblocked by pushing", async () => {
  const queue = new AsyncQueue<null>();
  let blocked = true;
  const promise = queue.shift().then(() => {
    blocked = false;
  });
  expect(blocked).toBe(true);
  queue.push(null);
  await promise;
  expect(blocked).toBe(false);
});

test("An unblocked queue can be blocked by draining", async () => {
  const queue = new AsyncQueue<boolean>();
  queue.push(false);
  let blocked = await Promise.race([
    new Promise((resolve) => setTimeout(resolve, 1, true)),
    queue.shift(),
  ]);
  expect(blocked).toBe(false);
  blocked = await Promise.race([
    new Promise((resolve) => setTimeout(resolve, 1, true)),
    queue.shift(),
  ]);
  expect(blocked).toBe(true);
});

test("A queue can be iterated over, and will yield until it's closed", async () => {
  const queue = new AsyncQueue<number>();
  const consume = async () => {
    const numbers = [];
    for await (const n of queue.iterator()) {
      numbers.push(n);
    }
    return numbers;
  };
  const valueCount = 7;
  const [values] = await Promise.all([
    consume(),
    new Promise((resolve) =>
      setTimeout(() => {
        for (let i = 0; i < valueCount; i++) {
          queue.push(i);
        }
        queue.close();
        resolve([]);
      }, 1)
    ),
  ]);
  expect(values).toEqual(Array.from({ length: valueCount }, (_, i) => i));
});

test("Closing a queue prevents pushes", async () => {
  const queue = new AsyncQueue<number>();
  const consume = async () => {
    const numbers = [];
    for await (const n of queue.iterator()) {
      numbers.push(n);
    }
    return numbers;
  };
  const pushedValues = [1, 2, 3];
  const nonPushedValues = [4, 5, 6];
  const nonPushedValuesAfterConsumption = [7, 8, 9];
  pushedValues.forEach(queue.push.bind(queue));
  queue.close();
  nonPushedValues.forEach(queue.push.bind(queue));
  const values = await consume();
  nonPushedValuesAfterConsumption.forEach(queue.push.bind(queue));
  const remainderValues = await consume();
  expect(values).toEqual(pushedValues);
  expect(remainderValues).toEqual([]);
});

test("A queue can be used as a channel", async () => {
  const queue = new AsyncQueue<number>();
  const { send, receive } = queue.asChannel();
  send(1, 2, 3);
  const { value: first } = await receive.next();
  const { value: second } = await receive.next();
  const { value: third } = await receive.next();
  expect(first).toEqual(1);
  expect(second).toEqual(2);
  expect(third).toEqual(3);
});
