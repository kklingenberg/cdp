import Redis from "ioredis";
import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/send-redis";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const redisUrl = "redis://localhost:6379/0";

test("@redis Send-redis works for single instance, publish", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    instance: redisUrl,
    publish: "send-test1",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  const receivedEvents: string[] = [];
  client.on("message", (_, received: string) => receivedEvents.push(received));
  await client.subscribe("send-test1");
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  await client.quit();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(events.map((e) => JSON.stringify(e)));
});

test("@redis Send-redis works for single instance, rpush", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    instance: redisUrl,
    rpush: "send-test2",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output, blpopResults] = await Promise.all([
    consume(channel.receive),
    (async () => {
      const r1 = await client.blpop("send-test2", 0);
      const r2 = await client.blpop("send-test2", 0);
      return [r1?.[1], r2?.[1]];
    })(),
    channel.close(),
  ]);
  await client.quit();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(blpopResults).toEqual(events.map((e) => JSON.stringify(e)));
});

test("@redis Send-redis works for single instance, lpush", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    instance: redisUrl,
    lpush: "send-test3",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output, brpopResults] = await Promise.all([
    consume(channel.receive),
    (async () => {
      const r1 = await client.brpop("send-test3", 0);
      const r2 = await client.brpop("send-test3", 0);
      return [r1?.[1], r2?.[1]];
    })(),
    channel.close(),
  ]);
  await client.quit();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(brpopResults).toEqual(events.map((e) => JSON.stringify(e)));
});

test("@redis Send-redis works in tandem with jq", async () => {
  // Arrange
  const client = new Redis(redisUrl);
  await client.flushall();
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    instance: redisUrl,
    lpush: "send-test4",
    "jq-expr": ".[].d",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output, brpopResults] = await Promise.all([
    consume(channel.receive),
    (async () => {
      const r1 = await client.brpop("send-test4", 0);
      const r2 = await client.brpop("send-test4", 0);
      return [r1?.[1], r2?.[1]];
    })(),
    resolveAfter(1000).then(() => channel.close()),
  ]);
  await client.quit();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(brpopResults).toEqual(["hello", "world"]);
});
