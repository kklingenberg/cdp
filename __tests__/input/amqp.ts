import { connect } from "amqplib";
import { make } from "../../src/input/amqp";

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
