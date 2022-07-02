import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/keep-when";
import { consume } from "../test-utils";

test("@standalone Keep-when works as expected", async () => {
  // Arrange
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    type: "object",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("not-an-object", 1, trace),
    await makeEvent("not-an-object", 2, trace),
    await makeEvent("an-object", { key: 3 }, trace),
    await makeEvent("an-object", { key: [4] }, trace),
    await makeEvent("not-an-object", [5], trace),
    await makeEvent("not-an-object", "6", trace),
    await makeEvent("not-an-object", true, trace),
    await makeEvent("not-an-object", null, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.name)).toEqual(["an-object", "an-object"]);
});
