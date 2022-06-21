// Mock the axios instance.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mockRequest = jest.fn();
/* eslint-enable @typescript-eslint/no-unused-vars */
jest.mock("../../src/io/axios", () => {
  const originalModule = jest.requireActual("../../src/io/axios");
  return {
    ...originalModule,
    axiosInstance: { request: mockRequest },
  };
});
afterEach(() => mockRequest.mockClear());

import { HTTP_CLIENT_MAX_RETRIES } from "../../src/conf";
import { request } from "../../src/io/http-client";

class TestError extends Error {
  response: object;
  constructor(message: string, response: object) {
    super(message);
    this.response = response;
  }
}

test("@standalone Request retrying works for all attempts", async () => {
  // Arrange
  mockRequest.mockImplementation(() =>
    Promise.reject(new TestError("test error", { status: 503 }))
  );
  // Act & assert
  await expect(request({ url: "whatever" })).rejects.toThrow("test error");
  expect(mockRequest).toHaveBeenCalledTimes(HTTP_CLIENT_MAX_RETRIES + 1);
});

test("@standalone Request retrying only works on 5xx status codes", async () => {
  // Arrange
  mockRequest.mockImplementation(() =>
    Promise.reject(new TestError("test error", { status: 400 }))
  );
  // Act & assert
  await expect(request({ url: "whatever" })).rejects.toThrow("test error");
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test("@standalone Request retrying can rescueue a request", async () => {
  // Arrange
  mockRequest
    .mockImplementationOnce(() =>
      Promise.reject(new TestError("test error", { status: 500 }))
    )
    .mockImplementationOnce(() => Promise.resolve({ data: "blagoblags" }));
  // Act
  const response = await request({ url: "whatever" });
  // Assert
  expect(response).toEqual({ data: "blagoblags" });
  expect(mockRequest).toHaveBeenCalledTimes(2);
});
