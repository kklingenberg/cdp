import * as pattern from "../src/pattern";

test("@standalone Event names can be checked for validity", () => {
  expect(pattern.isValidEventName("foo.bar.baz")).toBe(true);
  expect(pattern.isValidEventName(".bar.baz")).toBe(false);
  expect(pattern.isValidEventName("*.bar.baz")).toBe(false);
});

test("@standalone Fixed pattern matches an equal string", () => {
  expect(pattern.match("foo.bar.baz", "foo.bar.baz")).toBe(true);
});

test("@standalone Fixed pattern rejects not-equal string", () => {
  expect(pattern.match("foo.bar.bars", "foo.bar.baz")).toBe(false);
});

test("@standalone Fixed pattern rejects substring", () => {
  expect(pattern.match("foo.bar", "foo.bar.baz")).toBe(false);
});

test("@standalone Star-wildcard pattern matches correctly", () => {
  expect(pattern.match("foo.bar.baz", "foo.*.baz")).toBe(true);
});

test("@standalone Hash-wildcard pattern matches zero occurrences", () => {
  expect(pattern.match("foo.bar.baz", "#.foo.bar.baz")).toBe(true);
  expect(pattern.match("foo", "foo.#")).toBe(true);
});

test("@standalone Hash-wildcard pattern matches many occurrences", () => {
  expect(pattern.match("foo.bar.baz", "#.baz")).toBe(true);
});

test("@standalone String patterns can be checked for validity", () => {
  expect(pattern.isValidPattern("foo.#.*")).toBe(true);
});

test("@standalone The empty string is NOT a valid pattern", () => {
  expect(pattern.isValidPattern("")).toBe(false);
});

test("@standalone Invalid string patterns are detected", () => {
  expect(pattern.isValidPattern("foo*.bar")).toBe(false);
});

test("@standalone Composite patterns can be checked for validity", () => {
  expect(pattern.isValidPattern({ or: ["foo.bar", "foo.baz"] })).toBe(true);
  expect(pattern.isValidPattern({ and: ["foo.bar", "foo.baz"] })).toBe(true);
  expect(pattern.isValidPattern({ not: "foo.bar" })).toBe(true);
  expect(pattern.isValidPattern({ xor: ["foo.bar", "foo.baz"] })).toBe(false);
});

test("@standalone Complex composite patterns work properly", () => {
  expect(
    pattern.match("foo.bar.baz", { not: { or: ["foo.bar", "foo.baz"] } })
  ).toBe(true);
  expect(pattern.match("foo.bar.baz", { and: ["#.baz", "foo.#"] })).toBe(true);
});
