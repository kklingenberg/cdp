import { consume } from "./test-utils";
import { AsyncQueue, flatMap, compose } from "../src/async-queue";

test("@standalone Shifting from an empty queue blocks", async () => {
  // Arrange
  const queue = new AsyncQueue<boolean>();
  // Act
  const blocked = await Promise.race([
    new Promise((resolve) => setTimeout(resolve, 1, true)),
    queue.shift(),
  ]);
  // Assert
  expect(blocked).toBe(true);
});

test("@standalone Shifting from a non-empty queue doesn't block", async () => {
  // Arrange
  const queue = new AsyncQueue<boolean>();
  // Act
  queue.push(false);
  const blocked = await Promise.race([
    new Promise((resolve) => setTimeout(resolve, 1, true)),
    queue.shift(),
  ]);
  // Assert
  expect(blocked).toBe(false);
});

test("@standalone A blocked queue can be unblocked by pushing", async () => {
  // Arrange
  const queue = new AsyncQueue<null>();
  let blocked = true;
  // Act & assert
  const promise = queue.shift().then(() => {
    blocked = false;
  });
  expect(blocked).toBe(true);
  queue.push(null);
  await promise;
  expect(blocked).toBe(false);
});

test("@standalone An unblocked queue can be blocked by draining", async () => {
  // Arrange
  const queue = new AsyncQueue<boolean>();
  // Act & assert
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

test("@standalone A queue can be iterated over, and will yield until it's closed", async () => {
  // Arrange
  const queue = new AsyncQueue<number>();
  const valueCount = 7;
  // Act
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
  // Assert
  expect(values).toEqual(Array.from({ length: valueCount }, (_, i) => i));
});

test("@standalone Closing a queue prevents pushes", async () => {
  // Arrange
  const queue = new AsyncQueue<number>();
  const pushedValues = [1, 2, 3];
  const nonPushedValues = [4, 5, 6];
  const nonPushedValuesAfterConsumption = [7, 8, 9];
  // Act
  pushedValues.forEach(queue.push.bind(queue));
  queue.close();
  nonPushedValues.forEach(queue.push.bind(queue));
  const values = await consume(queue.iterator());
  nonPushedValuesAfterConsumption.forEach(queue.push.bind(queue));
  const remainderValues = await consume(queue.iterator());
  // Assert
  expect(values).toEqual(pushedValues);
  expect(remainderValues).toEqual([]);
});

test("@standalone A queue can be used as a channel", async () => {
  // Arrange
  const queue = new AsyncQueue<number>();
  // Act
  const { send, receive } = queue.asChannel();
  send(1, 2, 3);
  const { value: first } = await receive.next();
  const { value: second } = await receive.next();
  const { value: third } = await receive.next();
  // Assert
  expect(first).toEqual(1);
  expect(second).toEqual(2);
  expect(third).toEqual(3);
});

test("@standalone A queue's drain promise won't resolve if the queue isn't closed", async () => {
  // Arrange
  const queue = new AsyncQueue<boolean>();
  let drained;
  // Act & assert
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

test("@standalone Channels can be composed with the compose combinator", async () => {
  // Arrange
  const firstQueue = new AsyncQueue<number>();
  const firstChannel = flatMap(async (x) => [x * x], firstQueue.asChannel());
  const secondQueue = new AsyncQueue<number>();
  const secondChannel = flatMap(
    async (x) => [x + 1, x - 1],
    secondQueue.asChannel()
  );
  // Act
  const firstSecond = compose(firstChannel, secondChannel);
  firstSecond.send(1, 2, 3);
  const firstSecondValues = await consume(firstSecond.receive, 6);
  // Assert
  expect(firstSecondValues).toEqual([4, 0, 9, 1, 16, 4]);
});
