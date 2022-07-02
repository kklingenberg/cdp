import { connect } from "amqplib";
import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/send-amqp";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const brokerUrl = "amqp://localhost:5672";

// Initialize an AMQP consumer for tests to use.
const makeConsumer = async (
  name: string,
  type: string,
  receivedEvents: string[]
) => {
  const conn = await connect(brokerUrl);
  const ch = await conn.createChannel();
  const { exchange } = await ch.assertExchange(name, type);
  const { queue } = await ch.assertQueue("");
  await ch.bindQueue(queue, exchange, "cdp");
  await ch.consume(queue, (message) =>
    receivedEvents.push(message?.content?.toString() ?? "non-matching")
  );
  return conn;
};

test("@amqp Send-amqp works as expected on direct exchanges", async () => {
  // Arrange
  const receivedEvents: string[] = [];
  const conn = await makeConsumer("test1.output", "direct", receivedEvents);
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: {
      name: "test1.output",
      type: "direct",
    },
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  for (const event of events) {
    channel.send([event]);
  }
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  await resolveAfter(1000);
  await conn.close();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(events.map((e) => JSON.stringify(e) + "\n"));
});

test("@amqp Send-amqp works as expected on fanout exchanges", async () => {
  // Arrange
  const receivedEvents: string[] = [];
  const conn = await makeConsumer("test2.output", "fanout", receivedEvents);
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: {
      name: "test2.output",
      type: "fanout",
    },
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  for (const event of events) {
    channel.send([event]);
  }
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  await resolveAfter(1000);
  await conn.close();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(events.map((e) => JSON.stringify(e) + "\n"));
});

test("@amqp Send-amqp works as expected on topic exchanges", async () => {
  // Arrange
  const receivedEvents: string[] = [];
  const conn = await makeConsumer("test3.output", "topic", receivedEvents);
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: {
      name: "test3.output",
      type: "topic",
    },
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  for (const event of events) {
    channel.send([event]);
  }
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  await resolveAfter(1000);
  await conn.close();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(events.map((e) => JSON.stringify(e) + "\n"));
});

test("@amqp Send-amqp works as expected when using jq filters", async () => {
  // Arrange
  const receivedEvents: string[] = [];
  const conn = await makeConsumer("test4.output", "topic", receivedEvents);
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: {
      name: "test4.output",
      type: "topic",
    },
    "jq-expr": ".",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  for (const event of events) {
    channel.send([event]);
  }
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1000).then(() => channel.close()),
  ]);
  await resolveAfter(1000);
  await conn.close();
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(events.map((e) => JSON.stringify([e])));
});
