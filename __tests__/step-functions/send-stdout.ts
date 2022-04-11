import { make as makeEvent } from "../../src/event";
import { resolveAfter } from "../../src/utils";
import { make } from "../../src/step-functions/send-stdout";
import { consume } from "../test-utils";

// Mock for console.log.
let mockedConsoleLog: jest.SpyInstance<void>;

beforeEach(() => {
  mockedConsoleLog = jest.spyOn(console, "log").mockImplementation(() => {
    // Prevent log messages during these tests.
  });
});

afterEach(() => {
  mockedConsoleLog.mockRestore();
});

test("Send-stdout works as expected", async () => {
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
  expect(mockedConsoleLog.mock.calls).toEqual([
    [JSON.stringify(events[0])],
    [JSON.stringify(events[1])],
  ]);
});

test("Send-stdout works when using a jq program to preprocess the data", async () => {
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
  expect(mockedConsoleLog.mock.calls).toEqual([["hello"], ['["world"]']]);
});
