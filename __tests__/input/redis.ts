import Redis from "ioredis";
import { make } from "../../src/input/redis";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const redisUrl = "redis://localhost:6379/0";

const testEvents = [
  { n: "foo", d: "fooo" },
  { n: "bar", d: "barr" },
  { n: "baz", d: "bazz" },
];

test("@redis The redis input form builds a one-way channel", async () => {
  // Arrange
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    instance: { path: redisUrl },
    subscribe: ["ignored"],
  });
  // Act
  const sent = channel.send();
  await Promise.race([channel.close(), stopped]);
  // Assert
  expect(sent).toEqual(false);
});

test("@redis The redis input form works for single instance, subscribe", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    instance: redisUrl,
    subscribe: ["test1-ignored", "test1", "test1-also-ignored"],
  });
  // Act
  await resolveAfter(1000); // Give time for the subscription to establish
  for (const event of testEvents) {
    await client.publish("test1", JSON.stringify(event));
  }
  await client.quit();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});

test("@redis The redis input form works for single instance, psubscribe", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    instance: redisUrl,
    psubscribe: ["test2*"],
  });
  // Act
  await resolveAfter(1000); // Give time for the subscription to establish
  for (const event of testEvents) {
    await client.publish("test2loremipsum", JSON.stringify(event));
  }
  await client.quit();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});

test("@redis The redis input form works for single instance, blpop", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    instance: redisUrl,
    blpop: ["test3", "test3-ignored"],
  });
  // Act
  await client.rpush(
    "test3",
    ...testEvents.map((event) => JSON.stringify(event))
  );
  await client.quit();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});

test("@redis The redis input form works for single instance, brpop", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    instance: redisUrl,
    brpop: ["test4", "test4-ignored"],
  });
  // Act
  await client.lpush(
    "test4",
    ...testEvents.map((event) => JSON.stringify(event))
  );
  await client.quit();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});
