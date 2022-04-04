import { AsyncQueue } from "../src/async-queue";
import { Event } from "../src/event";
import { INPUT_ALIAS, validate } from "../src/pipeline";

// This mock is used to prepare dummy pipelines.
const dummyStepFactory = async () => new AsyncQueue<Event>().asChannel();

// Tests start here.

test("Pipeline validation detects usage of the reserved step name", () => {
  const pipeline = {
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
