import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/deduplicate";
import { consume } from "../test-utils";

test("Deduplicate works as expected", async () => {
  // Arrange
  const channel = await make("irrelevant", "irrelevant", null);
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 3.14, trace),
    await makeEvent("a", 3.14, trace),
    await makeEvent("a", 3.141, trace),
    await makeEvent("a", 3.14, trace),
    await makeEvent("a", 3.14, trace),
    await makeEvent("a", 3.141, trace),
    await makeEvent("a", 3.14, trace),
    await makeEvent("a", 3.1415, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual([3.14, 3.141, 3.1415]);
});
