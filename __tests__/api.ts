import { makePipelineTemplate } from "../src/api";

test("Pipeline template construction works normally", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { reduce: { "send-stdout": {} } },
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

test("Pipeline template construction works on empty pipelines", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: {} },
  };
  // Act & assert
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("Pipeline template construction accepts extra keys at the root", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: {} },
    extraKey: "This value is not explicitly used by CDP",
  };
  // Act & assert
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("The function keep-when must hold a valid schema", () => {
  // Arrange
  const raw = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { flatmap: { "keep-when": { not: "a real schema" } } },
    },
  };
  // Act & assert
  expect(() => makePipelineTemplate(raw)).toThrow();
});
