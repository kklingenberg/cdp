import { Readable } from "stream";
// Mock the stdin wrapper module.
const mockSTDINGetter = jest.fn(() =>
  Readable.from(["Lorem ipsum\n", "Dolor sit amet\n"])
);
jest.mock("../../src/io/stdin", () => {
  const originalModule = jest.requireActual("../../src/io/stdin");
  return {
    ...originalModule,
    getSTDIN: mockSTDINGetter,
  };
});
afterEach(() => mockSTDINGetter.mockClear());

import { make } from "../../src/input/stdin";
import { consume } from "../test-utils";

test("@standalone The stdin input form works as expected", async () => {
  // Arrange
  const [channel] = make("irrelevant", "irrelevant", {
    wrap: { name: "test", raw: true },
  });
  // Act
  const sent = channel.send();
  const output = await consume(channel.receive);
  // Assert
  expect(sent).toEqual(false);
  expect(output.map((e) => e.data)).toEqual([
    "Lorem ipsum\n",
    "Dolor sit amet\n",
  ]);
});
