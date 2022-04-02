import { AsyncQueue } from "../src/async-queue";
import { Event } from "../src/event";
import { INPUT_ALIAS, validate } from "../src/pipeline";

// These mocks are used to prepare dummy pipelines.

const dummyInput = (async function* () {
  // Empty function
})();

const dummyStepFactory = async () => new AsyncQueue<Event>();

// Tests start here.

test("Pipeline validation detects usage of the reserved step name", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["bar", "baz"],
        factory: dummyStepFactory,
      },
      {
        name: INPUT_ALIAS,
        after: ["foo"],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).toThrow("reserved name");
});

test("Pipeline validation detects duplicate step names", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["bar", "baz"],
        factory: dummyStepFactory,
      },
      {
        name: "bar",
        after: ["foo"],
        factory: dummyStepFactory,
      },
      {
        name: "foo",
        after: ["baz"],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).toThrow("not unique");
});

test("Pipeline validation detects dangling dependencies", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["bar", "baz"],
        factory: dummyStepFactory,
      },
      {
        name: "bar",
        after: ["foo", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).toThrow("dangling dependency");
});

test("Pipeline validation accepts a direct dependency to the input alias", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["bar", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
      {
        name: "bar",
        after: [INPUT_ALIAS],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).not.toThrow();
});

test("Pipeline validation detects a trivial graph cycle", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["foo", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).toThrow("dependency cycle");
});

test("Pipeline validation detects a graph cycle of greater length", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["bar", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
      {
        name: "bar",
        after: ["baz", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
      {
        name: "baz",
        after: ["foo", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).toThrow(
    "dependency cycle: foo --> bar --> baz --> foo"
  );
});

test("Pipeline validation accepts shared dependencies", () => {
  const pipeline = {
    input: dummyInput,
    steps: [
      {
        name: "foo",
        after: ["bar", "baz"],
        factory: dummyStepFactory,
      },
      {
        name: "bar",
        after: ["baz"],
        factory: dummyStepFactory,
      },
      {
        name: "baz",
        after: [],
        factory: dummyStepFactory,
      },
    ],
  };
  expect(() => validate(pipeline)).not.toThrow();
});
