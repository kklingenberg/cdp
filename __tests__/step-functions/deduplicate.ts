import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/deduplicate";
import { consume } from "../test-utils";

const testParams = {
  pipelineName: "irrelevant",
  pipelineSignature: "irrelevant",
  stepName: "irrelevant",
};

test("@standalone Deduplicate works as expected", async () => {
  // Arrange
  const channel = await make(testParams, null);
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

test("@standalone Deduplicate can consider specific parts of events", async () => {
  // Arrange
  const channel = await make(testParams, {
    "consider-name": false,
    "consider-data": true,
    "consider-trace": false,
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 3.14, trace),
    await makeEvent("b", 3.14, trace),
    await makeEvent("c", 3.141, trace),
    await makeEvent("d", 3.14, trace),
    await makeEvent("e", 3.14, trace),
    await makeEvent("f", 3.141, trace),
    await makeEvent("g", 3.14, trace),
    await makeEvent("h", 3.1415, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual([3.14, 3.141, 3.1415]);
  expect(output.map((e) => e.name)).toEqual(["a", "c", "h"]);
});
