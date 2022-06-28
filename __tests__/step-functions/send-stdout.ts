import { PassThrough, Readable } from "stream";
// Mock the stdio wrapper module.
const stdoutMock = {
  current: null,
} as {
  current: Readable | null;
};
const mockSTDOUTGetter = jest.fn(() => {
  const mock = new PassThrough();
  mock.setEncoding("utf-8");
  stdoutMock.current = mock;
  return mock;
});
jest.mock("../../src/io/stdio", () => {
  const originalModule = jest.requireActual("../../src/io/stdio");
  return {
    ...originalModule,
    getSTDOUT: mockSTDOUTGetter,
  };
});
afterEach(() => mockSTDOUTGetter.mockClear());

import { make as makeEvent } from "../../src/event";
import { resolveAfter } from "../../src/utils";
import { make } from "../../src/step-functions/send-stdout";
import { consume } from "../test-utils";

test("@standalone Send-stdout works as expected", async () => {
  // Arrange
  const channel = await make("irrelevant", "irrelevant", null);
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(stdoutMock.current?.read()).toEqual(
    `${JSON.stringify(events[0])}\n${JSON.stringify(events[1])}\n`
  );
});

test("@standalone Send-stdout works when using a jq program to preprocess the data", async () => {
  // Arrange
  const channel = await make("irrelevant", "irrelevant", {
    "jq-expr": ".[].d",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", ["world"], trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1).then(() => channel.close()),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", ["world"]]);
  // The 'hello' sent to STDOUT is not JSON-encoded. This is expected.
  expect(stdoutMock.current?.read()).toEqual('hello\n["world"]\n');
});
