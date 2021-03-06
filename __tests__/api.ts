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
jest.mock("../src/io/stdio", () => {
  const originalModule = jest.requireActual("../src/io/stdio");
  return {
    ...originalModule,
    getSTDOUT: mockSTDOUTGetter,
  };
});
afterEach(() => mockSTDOUTGetter.mockClear());

import { makePipelineTemplate, runPipeline } from "../src/api";
import { resolveAfter } from "../src/utils";

test("@standalone Pipeline template construction works normally", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: { wrap: { name: "lorem.ipsum", raw: true } } },
    steps: {
      a: { reduce: { "send-http": "http://non-existent.org/events" } },
      b: { flatmap: { "keep-when": {} } },
      c: {
        after: ["a", "b"],
        "match/pass": { and: ["lorem.#", "#.ipsum"] },
        window: {
          events: 5,
          seconds: "60.5",
        },
        flatmap: {
          "send-receive-http": {
            target: "https://remote-service:8000/events",
            "jq-expr": ".[].d",
            headers: {
              "x-api-key": "supersecret",
            },
          },
        },
      },
    },
  };
  // Act & assert
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("@standalone Pipeline template construction works on empty pipelines", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: {} },
  };
  // Act & assert
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("@standalone Pipeline template construction accepts extra keys at the root", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: {} },
    extraKey: "This value is not explicitly used by CDP",
  };
  // Act & assert
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("@standalone Functions must use exactly one of flatmap or reduce", () => {
  // Arrange
  const missingBoth = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: {},
    },
  };
  const havingBoth = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { flatmap: { keep: 1 }, reduce: { keep: 1 } },
    },
  };
  const correct = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { reduce: { keep: 1 } },
    },
  };
  // Act & assert
  expect(() => makePipelineTemplate(missingBoth)).toThrow();
  expect(() => makePipelineTemplate(havingBoth)).toThrow();
  expect(() => makePipelineTemplate(correct)).not.toThrow();
});

test("@standalone The function keep-when must hold a valid schema", () => {
  // Arrange
  const invalidRaw = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { flatmap: { "keep-when": { not: "a real schema" } } },
    },
  };
  const validRaw = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { flatmap: { "keep-when": { const: "a real schema" } } },
    },
  };
  // Act & assert
  expect(() => makePipelineTemplate(invalidRaw)).toThrow();
  expect(() => makePipelineTemplate(validRaw)).not.toThrow();
});

test("@standalone Stopping a pipeline drains the events", async () => {
  // Arrange
  const rawTemplate = {
    name: "Test",
    input: { generator: { seconds: 0.1 } },
    steps: {
      a: {
        window: { events: 10, seconds: 999 },
        flatmap: { "send-stdout": { "jq-expr": "{count: length}" } },
      },
    },
  };
  // Act
  const template = makePipelineTemplate(rawTemplate);
  const [promise, stopper] = await runPipeline(template);
  await Promise.all([promise, resolveAfter(1000).then(() => stopper())]);
  // Assert
  // 10 slices should have passed, because there are 10 intervals of
  // size 0.1 seconds in 1 second.
  expect(stdoutMock.current?.read()).toEqual(
    Array.from({ length: 10 }, (_, index) =>
      JSON.stringify({ count: 10 - index })
    ).join("\n") + "\n"
  );
});
