import { AsyncQueue, drain } from "../src/async-queue";
import { Event } from "../src/event";
import { INPUT_ALIAS, validate } from "../src/pipeline";

// This mock is used to prepare dummy pipelines.
const dummyStepFactory = async () =>
  drain(new AsyncQueue<Event>().asChannel(), () => Promise.resolve());

// Tests start here.

test("Pipeline validation detects usage of the reserved step name", () => {
  // Arrange
  const pipeline = {
    name: "Test",
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
  // Act & assert
  expect(() => validate(pipeline)).toThrow("reserved name");
});

test("Pipeline validation detects duplicate step names", () => {
  // Arrange
  const pipeline = {
    name: "Test",
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
  // Act & assert
  expect(() => validate(pipeline)).toThrow("not unique");
});

test("Pipeline validation detects dangling dependencies", () => {
  // Arrange
  const pipeline = {
    name: "Test",
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
  // Act & assert
  expect(() => validate(pipeline)).toThrow("dangling dependency");
});

test("Pipeline validation accepts a direct dependency to the input alias", () => {
  // Arrange
  const pipeline = {
    name: "Test",
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
  // Act & assert
  expect(() => validate(pipeline)).not.toThrow();
});

test("Pipeline validation detects a trivial graph cycle", () => {
  // Arrange
  const pipeline = {
    name: "Test",
    steps: [
      {
        name: "foo",
        after: ["foo", INPUT_ALIAS],
        factory: dummyStepFactory,
      },
    ],
  };
  // Act & assert
  expect(() => validate(pipeline)).toThrow("dependency cycle");
});

test("Pipeline validation detects a graph cycle of greater length", () => {
  // Arrange
  const pipeline = {
    name: "Test",
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
  // Act & assert
  expect(() => validate(pipeline)).toThrow(
    "dependency cycle: foo --> bar --> baz --> foo"
  );
});

test("Pipeline validation accepts shared dependencies", () => {
  // Arrange
  const pipeline = {
    name: "Test",
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
  // Act & assert
  expect(() => validate(pipeline)).not.toThrow();
});
