import { make as makeEvent } from "../../src/event";
import { resolveAfter } from "../../src/utils";
import { make } from "../../src/step-functions/send-receive-jsonnet";
import { consume } from "../test-utils";

test("@standalone Send-receive-jsonnet works as expected", async () => {
  // Arrange
  const pipelineName = "test";
  const pipelineSignature = "signature";
  const channel = await make(
    { pipelineName, pipelineSignature, stepName: "irrelevant" },
    {
      "jsonnet-expr": `function(events) std.map(function(event) event + {d: "replaced!"}, events)`,
    }
  );
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

test("@standalone Send-receive-jsonnet will filter out events that are invalid", async () => {
  // Arrange
  const pipelineName = "test";
  const pipelineSignature = "signature";
  const channel = await make(
    { pipelineName, pipelineSignature, stepName: "irrelevant" },
    `function(events) [events[0] + {n: "invalid name"}] + events[1:]`
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
