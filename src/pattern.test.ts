import * as pattern from "./pattern";

test("Fixed pattern matches an equal string", () => {
  expect(pattern.match("foo.bar.baz", "foo.bar.baz")).toBe(true);
});

test("Fixed pattern rejects not-equal string", () => {
  expect(pattern.match("foo.bar.bars", "foo.bar.baz")).toBe(false);
});

test("Fixed pattern rejects substring", () => {
  expect(pattern.match("foo.bar", "foo.bar.baz")).toBe(false);
});

test("Star-wildcard pattern matches correctly", () => {
  expect(pattern.match("foo.bar.baz", "foo.*.baz")).toBe(true);
});

test("Hash-wildcard pattern matches zero occurrences", () => {
  expect(pattern.match("foo.bar.baz", "#.foo.bar.baz")).toBe(true);
});

test("Hash-wildcard pattern matches many occurrences", () => {
  expect(pattern.match("foo.bar.baz", "#.baz")).toBe(true);
});

test("String patterns can be checked for validity", () => {
  expect(pattern.isValidPattern("foo.#.*")).toBe(true);
});

test("The empty string is NOT a valid pattern", () => {
  expect(pattern.isValidPattern("")).toBe(false);
});

test("Invalid string patterns are detected", () => {
  expect(pattern.isValidPattern("foo*.bar")).toBe(false);
});

test("Composite patterns can be checked for validity", () => {
  expect(pattern.isValidPattern({ or: ["foo.bar", "foo.baz"] })).toBe(true);
});

test("Complex composite patterns work properly", () => {
  expect(
    pattern.match("foo.bar.baz", { not: { or: ["foo.bar", "foo.baz"] } })
  ).toBe(true);
});
