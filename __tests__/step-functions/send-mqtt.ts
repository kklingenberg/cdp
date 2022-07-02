import { connect } from "mqtt";
import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/send-mqtt";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const brokerUrl = "mqtt://localhost:1883";

// Initialize a MQTT subscriber for tests to use.
const makeSubscriber = async (topic: string, receivedEvents: string[]) => {
  const client = connect(brokerUrl, {});
  await (new Promise((resolve, reject) => {
    client.on("connect", () => {
      client.subscribe(topic, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }) as Promise<void>);
  client.on("message", (_, message) => receivedEvents.push(message.toString()));
  return client;
};

test("@mqtt Send-mqtt works as expected", async () => {
  // Arrange
  const receivedEvents: string[] = [];
  const client = await makeSubscriber("test1/#", receivedEvents);
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    url: brokerUrl,
    topic: "test1/loremipsum",
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
  await (new Promise((resolve) =>
    client.end(false, {}, () => resolve())
  ) as Promise<void>);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(events.map((e) => JSON.stringify(e) + "\n"));
});

test("@mqtt Send-mqtt works as expected when using jq filters", async () => {
  // Arrange
  const receivedEvents: string[] = [];
  const client = await makeSubscriber("test2/#", receivedEvents);
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    url: brokerUrl,
    topic: "test2/loremipsum",
    "jq-expr": ".[].d",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  await resolveAfter(1000);
  await (new Promise((resolve) =>
    client.end(false, {}, () => resolve())
  ) as Promise<void>);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(receivedEvents).toEqual(["hello", "world"]);
});
