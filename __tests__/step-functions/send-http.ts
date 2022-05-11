// Mock the axios instance.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mockRequest = jest.fn(async (options) => ({}));
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
import { make } from "../../src/step-functions/send-http";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("Send-http works as expected", async () => {
  // Arrange
  const target = "http://nothing";
  const method = "PATCH";
  const channel = await make("irrelevant", "irrelevant", { target, method });
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
  expect(mockRequest.mock.calls).toHaveLength(1);
  expect(mockRequest.mock.calls[0]).toHaveLength(1);
  expect(mockRequest.mock.calls[0][0].url).toEqual(target);
  expect(mockRequest.mock.calls[0][0].method).toEqual(method);
  expect(mockRequest.mock.calls[0][0].data).toEqual(events);
  expect(mockRequest.mock.calls[0][0].headers).toEqual({
    "content-type": "application/x-ndjson",
  });
});

test("Send-http works when specifying a target plainly", async () => {
  // Arrange
  const target = "http://nothing";
  const method = "POST";
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
  expect(mockRequest.mock.calls).toHaveLength(1);
  expect(mockRequest.mock.calls[0]).toHaveLength(1);
  expect(mockRequest.mock.calls[0][0].url).toEqual(target);
  expect(mockRequest.mock.calls[0][0].method).toEqual(method);
  expect(mockRequest.mock.calls[0][0].data).toEqual(events);
  expect(mockRequest.mock.calls[0][0].headers).toEqual({
    "content-type": "application/x-ndjson",
  });
});

test("Send-http works when specifying a jq expression and headers", async () => {
  // Arrange
  const target = "http://nothing";
  const method = "PUT";
  const channel = await make("irrelevant", "irrelevant", {
    target,
    method,
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
  expect(mockRequest.mock.calls).toHaveLength(2);
  expect(mockRequest.mock.calls[0]).toHaveLength(1);
  expect(mockRequest.mock.calls[0][0].url).toEqual(target);
  expect(mockRequest.mock.calls[0][0].method).toEqual(method);
  expect(mockRequest.mock.calls[0][0].data).toEqual("hello");
  expect(mockRequest.mock.calls[0][0].headers).toEqual({
    "content-type": "text/plain",
  });
  expect(mockRequest.mock.calls[1]).toHaveLength(1);
  expect(mockRequest.mock.calls[1][0].url).toEqual(target);
  expect(mockRequest.mock.calls[1][0].method).toEqual(method);
  expect(mockRequest.mock.calls[1][0].data).toEqual("world");
  expect(mockRequest.mock.calls[1][0].headers).toEqual({
    "content-type": "text/plain",
  });
});
