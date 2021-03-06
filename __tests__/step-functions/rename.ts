import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/rename";
import { consume } from "../test-utils";

const testParams = {
  pipelineName: "irrelevant",
  pipelineSignature: "irrelevant",
  stepName: "irrelevant",
};

test("@standalone Renaming with replacement works as expected", async () => {
  // Arrange
  const channel = await make(testParams, {
    replace: "replaced",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 1, trace),
    await makeEvent("b", 2, trace),
    await makeEvent("c", 3, trace),
    await makeEvent("d", 4, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.name)).toEqual([
    "replaced",
    "replaced",
    "replaced",
    "replaced",
  ]);
});

test("@standalone Renaming with prepend works as expected", async () => {
  // Arrange
  const channel = await make(testParams, {
    prepend: "prefix.",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 1, trace),
    await makeEvent("b", 2, trace),
    await makeEvent("c", 3, trace),
    await makeEvent("d", 4, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.name)).toEqual([
    "prefix.a",
    "prefix.b",
    "prefix.c",
    "prefix.d",
  ]);
});

test("@standalone Renaming with append works as expected", async () => {
  // Arrange
  const channel = await make(testParams, {
    append: ".suffix",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 1, trace),
    await makeEvent("b", 2, trace),
    await makeEvent("c", 3, trace),
    await makeEvent("d", 4, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.name)).toEqual([
    "a.suffix",
    "b.suffix",
    "c.suffix",
    "d.suffix",
  ]);
});

test("@standalone Renaming with prepend and append works as expected", async () => {
  // Arrange
  const channel = await make(testParams, {
    prepend: "prefix.",
    append: ".suffix",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", 1, trace),
    await makeEvent("b", 2, trace),
    await makeEvent("c", 3, trace),
    await makeEvent("d", 4, trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.name)).toEqual([
    "prefix.a.suffix",
    "prefix.b.suffix",
    "prefix.c.suffix",
    "prefix.d.suffix",
  ]);
});
