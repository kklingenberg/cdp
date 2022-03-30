import * as utils from "../src/utils";

test("Signatures can be obtained for any JSON-encodable thing", async () => {
  const signature = await utils.getSignature(
    "foo",
    2,
    true,
    null,
    { hello: "world" },
    ["bar"]
  );
  expect(signature).toBeTruthy();
});

test("Signatures can't be generated for non JSON-encodable things", async () => {
  await expect(utils.getSignature(undefined)).rejects.toThrow();
});

test("Loggers can be created according to the current log level", () => {
  // Assumes the current log level is 'error'.
  // This tests uses the fact that the null logger functions return
  // null, while the active logger functions return undefined.
  const logger = utils.makeLogger("test");
  expect(logger.debug("test")).toBeNull();
  expect(logger.info("test")).toBeNull();
  expect(logger.warn("test")).toBeNull();
  expect(logger.error("test")).toBeUndefined();
});
