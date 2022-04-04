import { consume } from "./test-utils";
import { AsyncQueue, flatMap, compose } from "../src/async-queue";

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
  const valueCount = 7;
  const [values] = await Promise.all([
    consume(queue.iterator()),
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
  const pushedValues = [1, 2, 3];
  const nonPushedValues = [4, 5, 6];
  const nonPushedValuesAfterConsumption = [7, 8, 9];
  pushedValues.forEach(queue.push.bind(queue));
  queue.close();
  nonPushedValues.forEach(queue.push.bind(queue));
  const values = await consume(queue.iterator());
  nonPushedValuesAfterConsumption.forEach(queue.push.bind(queue));
  const remainderValues = await consume(queue.iterator());
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

test("A queue's drain promise won't resolve if the queue isn't closed", async () => {
  const queue = new AsyncQueue<boolean>();
  let drained;
  drained = await Promise.race([
    queue.drain.then(() => true),
    new Promise((resolve) => setTimeout(resolve, 1, false)),
  ]);
  expect(drained).toBe(false);
  queue.close();
  drained = await Promise.race([
    queue.drain.then(() => true),
    new Promise((resolve) => setTimeout(resolve, 1, false)),
  ]);
  expect(drained).toBe(true);
});

test("Channels can be composed with the compose combinator", async () => {
  const firstQueue = new AsyncQueue<number>();
  const firstChannel = flatMap(async (x) => [x * x], firstQueue.asChannel());
  const secondQueue = new AsyncQueue<number>();
  const secondChannel = flatMap(
    async (x) => [x + 1, x - 1],
    secondQueue.asChannel()
  );
  const firstSecond = compose(firstChannel, secondChannel);
  firstSecond.send(1, 2, 3);
  const firstSecondValues = await consume(firstSecond.receive, 6);
  expect(firstSecondValues).toEqual([4, 0, 9, 1, 16, 4]);
});
