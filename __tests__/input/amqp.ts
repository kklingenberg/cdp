import { connect } from "amqplib";
import { make } from "../../src/input/amqp";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const brokerUrl = "amqp://localhost:5672";

const testEvents = [
  { n: "foo", d: "fooo" },
  { n: "bar", d: "barr" },
  { n: "baz", d: "bazz" },
];

test("@amqp The amqp input form builds a one-way channel", async () => {
  // Arrange
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: { name: "test1.input", type: "direct" },
  });
  // Act
  const sent = channel.send();
  await Promise.race([channel.close(), stopped]);
  // Assert
  expect(sent).toEqual(false);
});

test("@amqp The amqp input closes automatically on corrupted channels", async () => {
  // Arrange
  const spy = jest.spyOn(console, "error").mockImplementation(() => {
    // Prevent error messages during these tests.
  });
  const conn = await connect(brokerUrl);
  const ch = await conn.createChannel();
  await ch.assertExchange("test2.input", "direct", { durable: false });
  // Act & assert
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: { name: "test2.input", type: "direct", durable: true },
  });
  await stopped; // stopped by the library/broker
  // Cleanup
  await channel.close();
  await ch.close();
  await conn.close();
  spy.mockRestore();
});

test("@amqp The amqp input works as expected on direct exchanges", async () => {
  // Arrange
  const conn = await connect(brokerUrl);
  const ch = await conn.createChannel();
  const { exchange } = await ch.assertExchange("test3.input", "direct");
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: { name: "test3.input", type: "direct" },
  });
  // Act
  await resolveAfter(1000); // Give time for the queue to bind
  ch.publish(
    exchange,
    "cdp",
    Buffer.from(testEvents.map((e) => JSON.stringify(e)).join("\n"))
  );
  await ch.close();
  await conn.close();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});

test("@amqp The amqp input works as expected on fanout exchanges", async () => {
  // Arrange
  const conn = await connect(brokerUrl);
  const ch = await conn.createChannel();
  const { exchange } = await ch.assertExchange("test4.input", "fanout");
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: { name: "test4.input", type: "fanout" },
  });
  // Act
  await resolveAfter(1000); // Give time for the queue to bind
  ch.publish(
    exchange,
    "irrelevant",
    Buffer.from(testEvents.map((e) => JSON.stringify(e)).join("\n"))
  );
  await ch.close();
  await conn.close();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});

test("@amqp The amqp input works as expected on topic exchanges", async () => {
  // Arrange
  const conn = await connect(brokerUrl);
  const ch = await conn.createChannel();
  const { exchange } = await ch.assertExchange("test5.input", "topic");
  const [channel, stopped] = make("irrelevant", "irrelevant", {
    url: brokerUrl,
    exchange: { name: "test5.input", type: "topic" },
    "binding-pattern": "test5.*.with-infix-wildcard",
  });
  // Act
  await resolveAfter(1000); // Give time for the queue to bind
  ch.publish(
    exchange,
    "test5.matches.with-infix-wildcard",
    Buffer.from(testEvents.map((e) => JSON.stringify(e)).join("\n"))
  );
  ch.publish(
    exchange,
    "test5.also-matches.with-infix-wildcard",
    Buffer.from(testEvents.map((e) => JSON.stringify(e)).join("\n"))
  );
  ch.publish(
    exchange,
    "test5.doesnt-match.because-of-the-suffix",
    Buffer.from(testEvents.map((e) => JSON.stringify(e)).join("\n"))
  );
  await ch.close();
  await conn.close();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents.concat(testEvents) // two successful publishes (out of three)
  );
});
