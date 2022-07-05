import { connect } from "mqtt";
import { make } from "../../src/input/mqtt";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const brokerUrl = "mqtt://localhost:1883";

const testEvents = [
  { n: "foo", d: "fooo" },
  { n: "bar", d: "barr" },
  { n: "baz", d: "bazz" },
];

const testParams = {
  pipelineName: "irrelevant",
  pipelineSignature: "irrelevant",
};

test("@mqtt The mqtt input form builds a one-way channel", async () => {
  // Arrange
  const [channel, stopped] = make(testParams, brokerUrl);
  // Act
  const sent = channel.send();
  await Promise.race([channel.close(), stopped]);
  // Assert
  expect(sent).toEqual(false);
});

test("@mqtt The mqtt input works as expected", async () => {
  // Arrange
  const client = connect(brokerUrl, {});
  const [channel, stopped] = make(testParams, {
    url: brokerUrl,
    topic: "test-input/2/+",
  });
  // Act
  await resolveAfter(1000); // Give time for the subscription to be established
  client.publish(
    "test-input/2/loremipsum",
    testEvents.map((e) => JSON.stringify(e)).join("\n")
  );
  client.end();
  const [output] = await Promise.all([
    consume(channel.receive),
    Promise.race([resolveAfter(1000).then(() => channel.close()), stopped]),
  ]);
  // Assert
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    testEvents
  );
});
