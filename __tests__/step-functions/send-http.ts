// Mock the axios instance.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mockPost = jest.fn(async (url, data, options) => ({}));
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
import { make } from "../../src/step-functions/send-http";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("Send-http works as expected", async () => {
  // Arrange
  const target = "http://nothing";
  const channel = await make("irrelevant", "irrelevant", { target });
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
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(mockPost.mock.calls).toHaveLength(1);
  expect(mockPost.mock.calls[0]).toHaveLength(3);
  expect(mockPost.mock.calls[0][0]).toEqual(target);
  expect(mockPost.mock.calls[0][1]).toEqual(events);
  expect(mockPost.mock.calls[0][2]?.headers).toEqual({
    "Content-Type": "application/x-ndjson",
  });
});

test("Send-http works when specifying a target plainly", async () => {
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
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(mockPost.mock.calls).toHaveLength(1);
  expect(mockPost.mock.calls[0]).toHaveLength(3);
  expect(mockPost.mock.calls[0][0]).toEqual(target);
  expect(mockPost.mock.calls[0][1]).toEqual(events);
  expect(mockPost.mock.calls[0][2]?.headers).toEqual({
    "Content-Type": "application/x-ndjson",
  });
});

test("Send-http works when specifying a jq expression and headers", async () => {
  // Arrange
  const target = "http://nothing";
  const channel = await make("irrelevant", "irrelevant", {
    target,
    "jq-expr": ".[].d",
    headers: { "Content-Type": "text/plain" },
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
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(mockPost.mock.calls).toHaveLength(2);
  expect(mockPost.mock.calls[0]).toHaveLength(3);
  expect(mockPost.mock.calls[0][0]).toEqual(target);
  expect(mockPost.mock.calls[0][1]).toEqual("hello");
  expect(mockPost.mock.calls[0][2]?.headers).toEqual({
    "Content-Type": "text/plain",
  });
  expect(mockPost.mock.calls[1]).toHaveLength(3);
  expect(mockPost.mock.calls[1][0]).toEqual(target);
  expect(mockPost.mock.calls[1][1]).toEqual("world");
  expect(mockPost.mock.calls[1][2]?.headers).toEqual({
    "Content-Type": "text/plain",
  });
});
