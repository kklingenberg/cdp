import { make as makeEvent } from "../../src/event";
import { resolveAfter } from "../../src/utils";
import { make } from "../../src/step-functions/send-receive-jq";
import { consume } from "../test-utils";

test("@standalone Send-receive-jq works as expected", async () => {
  // Arrange
  const pipelineName = "test";
  const pipelineSignature = "signature";
  const channel = await make(pipelineName, pipelineSignature, {
    "jq-expr": `map(. * {d: "replaced!"})`,
  });
  const trace = [{ i: 1, p: pipelineName, h: pipelineSignature }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1).then(() => channel.close()),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["replaced!", "replaced!"]);
});

test("@standalone Send-receive-jq will filter out events that are invalid", async () => {
  // Arrange
  const pipelineName = "test";
  const pipelineSignature = "signature";
  const channel = await make(
    pipelineName,
    pipelineSignature,
    `[.[0] * {n: "invalid name"}] + .[1:]`
  );
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "cruel", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1).then(() => channel.close()),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["cruel", "world"]);
});
