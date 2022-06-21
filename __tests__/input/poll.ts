import { Readable } from "stream";
// Mock the axios instance.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mockRequest = jest.fn(async (url) => ({
  status: 200,
  headers: {},
  data: Readable.from(['{"n":"n","d":{"lorem":"ipsum"}}']), // Less than 32 bytes, crucially.
}));
/* eslint-enable @typescript-eslint/no-unused-vars */
jest.mock("../../src/io/axios", () => {
  const originalModule = jest.requireActual("../../src/io/axios");
  return {
    ...originalModule,
    axiosInstance: { get: mockRequest },
  };
});
afterEach(() => mockRequest.mockClear());

import { make } from "../../src/input/poll";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("@standalone The poll input form works as expected", async () => {
  // Arrange
  const [channel] = make("irrelevant", "irrelevant", {
    target: "http://non-existent.org",
    seconds: 0.19,
  });
  // Act
  const sent = channel.send();
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1000).then(() => channel.close()),
  ]);
  // Assert
  expect(sent).toEqual(false);
  expect(output.map((e) => e.data)).toEqual([
    { lorem: "ipsum" },
    { lorem: "ipsum" },
    { lorem: "ipsum" },
    { lorem: "ipsum" },
    { lorem: "ipsum" },
  ]);
});
