import { Readable } from "stream";
// Mock the axios instance.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mockRequest = jest.fn(async (options) => ({
  data: Readable.from(['{"n":"n","d":{"lorem":"ipsum"}}']), // Less than 32 bytes, crucially.
}));
/* eslint-enable @typescript-eslint/no-unused-vars */
jest.mock("../../src/io/axios", () => {
  const originalModule = jest.requireActual("../../src/io/axios");
  return {
    ...originalModule,
    axiosInstance: { request: mockRequest },
  };
});
afterEach(() => mockRequest.mockClear());

import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/send-receive-http";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

const testParams = {
  pipelineName: "irrelevant",
  pipelineSignature: "irrelevant",
  stepName: "irrelevant",
};

test("@standalone Send-receive-http works as expected", async () => {
  // Arrange
  const target = "http://nothing";
  const method = "POST";
  const channel = await make(testParams, target);
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
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
  expect(output.map((e) => e.name)).toEqual(["n"]);
  expect(output.map((e) => e.data)).toEqual([{ lorem: "ipsum" }]);
  expect(mockRequest.mock.calls).toHaveLength(1);
  expect(mockRequest.mock.calls[0]).toHaveLength(1);
  expect(mockRequest.mock.calls[0][0].url).toEqual(target);
  expect(mockRequest.mock.calls[0][0].method).toEqual(method);
  expect(mockRequest.mock.calls[0][0].data).toEqual(events);
  expect(mockRequest.mock.calls[0][0].headers).toEqual({
    "content-type": "application/x-ndjson",
  });
});

test("@standalone Send-receive-http works when using jq as intermediary", async () => {
  // Arrange
  const target = "http://nothing";
  const method = "PATCH";
  const channel = await make(testParams, {
    target,
    method,
    "jq-expr": `[.[] | . * {n: "changed"}]`,
    headers: { "Content-Type": "application/json" },
    wrap: "result",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
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
  expect(output.map((e) => e.name)).toEqual(["result"]);
  expect(output.map((e) => e.data)).toEqual([
    { n: "n", d: { lorem: "ipsum" } },
  ]);
  expect(mockRequest.mock.calls).toHaveLength(1);
  expect(mockRequest.mock.calls[0]).toHaveLength(1);
  expect(mockRequest.mock.calls[0][0].url).toEqual(target);
  expect(mockRequest.mock.calls[0][0].method).toEqual(method);
  expect(mockRequest.mock.calls[0][0].data).toEqual(
    events.map((e) => e.toJSON()).map((e) => ({ ...e, n: "changed" }))
  );
  expect(mockRequest.mock.calls[0][0].headers).toEqual({
    "content-type": "application/json",
  });
});
