import { Readable } from "stream";
// Mock the axios instance.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mockPost = jest.fn(async (url, data, options) => ({
  data: Readable.from(['{"n":"n","d":{"lorem":"ipsum"}}']), // Less than 32 bytes, crucially.
}));
/* eslint-enable @typescript-eslint/no-unused-vars */
jest.mock("../../src/io/axios", () => {
  const originalModule = jest.requireActual("../../src/io/axios");
  return {
    ...originalModule,
    axiosInstance: { post: mockPost },
  };
});
afterEach(() => mockPost.mockClear());

import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/send-receive-http";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("Send-receive-http works as expected", async () => {
  // Arrange
  const target = "http://nothing";
  const channel = await make("irrelevant", "irrelevant", target);
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
  expect(mockPost.mock.calls).toHaveLength(1);
  expect(mockPost.mock.calls[0]).toHaveLength(3);
  expect(mockPost.mock.calls[0][0]).toEqual(target);
  expect(mockPost.mock.calls[0][1]).toEqual(events);
  expect(mockPost.mock.calls[0][2]?.headers).toEqual({
    "Content-Type": "application/x-ndjson",
  });
});

test("Send-receive-http works when using jq as intermediary", async () => {
  // Arrange
  const target = "http://nothing";
  const channel = await make("irrelevant", "irrelevant", {
    target,
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
  expect(mockPost.mock.calls).toHaveLength(1);
  expect(mockPost.mock.calls[0]).toHaveLength(3);
  expect(mockPost.mock.calls[0][0]).toEqual(target);
  expect(mockPost.mock.calls[0][1]).toEqual(
    events.map((e) => e.toJSON()).map((e) => ({ ...e, n: "changed" }))
  );
  expect(mockPost.mock.calls[0][2]?.headers).toEqual({
    "Content-Type": "application/json",
  });
});
