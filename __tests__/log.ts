import { makeLogger } from "../src/log";

// Mock for console.error.
let mockedConsoleError: jest.SpyInstance<void>;

beforeEach(() => {
  mockedConsoleError = jest.spyOn(console, "error").mockImplementation(() => {
    // Prevent error messages during these tests.
  });
});

afterEach(() => {
  mockedConsoleError.mockRestore();
});

test("Loggers can be created according to the current log level", () => {
  // Assumes the current log level is 'error'.
  // This tests uses the fact that the null logger functions return
  // null, while the active logger functions return undefined.
  const logger = makeLogger("test");
  expect(logger.debug("this message was not expected")).toBeNull();
  expect(logger.info("this message was not expected")).toBeNull();
  expect(logger.warn("this message was not expected")).toBeNull();
  expect(logger.error("this message is expected")).toBeUndefined();
  expect(mockedConsoleError.mock.calls).toEqual([
    ["ERROR at test:", "this message is expected"],
  ]);
});
