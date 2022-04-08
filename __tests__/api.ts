import { makePipelineTemplate } from "../src/api";

test("Pipeline template construction works normally", () => {
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
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("Pipeline template construction works on empty pipelines", () => {
  const raw = {
    name: "Test",
    input: { stdin: {} },
  };
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("Pipeline template construction accepts extra keys at the root", () => {
  const raw = {
    name: "Test",
    input: { stdin: {} },
    extraKey: "This value is not explicitly used by CDP",
  };
  expect(() => makePipelineTemplate(raw)).not.toThrow();
});

test("The function keep-when must hold a valid schema", () => {
  const raw = {
    name: "Test",
    input: { stdin: {} },
    steps: {
      a: { flatmap: { "keep-when": { not: "a real schema" } } },
    },
  };
  expect(() => makePipelineTemplate(raw)).toThrow();
});
