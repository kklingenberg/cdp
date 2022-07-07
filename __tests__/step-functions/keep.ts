import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/keep";
import { consume } from "../test-utils";

const testParams = {
  pipelineName: "irrelevant",
  pipelineSignature: "irrelevant",
  stepName: "irrelevant",
};

test("@standalone Keep works as expected", async () => {
  // Arrange
  const channel = await make(testParams, 3);
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 1, trace),
    await makeEvent("a", 2, trace),
    await makeEvent("a", 3, trace),
    await makeEvent("a", 4, trace),
    await makeEvent("a", 5, trace),
    await makeEvent("a", 6, trace),
    await makeEvent("a", 7, trace),
    await makeEvent("a", 8, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual([1, 2, 3]);
});

test("@standalone Keep doesn't fail if the incoming event vector has fewer events", async () => {
  // Arrange
  const channel = await make(testParams, "3");
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 1, trace),
    await makeEvent("a", 2, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual([1, 2]);
});
