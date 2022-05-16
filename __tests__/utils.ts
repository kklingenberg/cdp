import * as utils from "../src/utils";

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

test("Signatures are distinct", async () => {
  const s1 = await utils.getSignature("foo", "bar");
  const s2 = await utils.getSignature("foobar");
  const s3 = await utils.getSignature("foo", undefined, "bar");
  expect(s1).not.toEqual(s2);
  expect(s1).not.toEqual(s3);
  expect(s2).not.toEqual(s3);
});

test("Environment variables can be replaced in objects", () => {
  const obj = {
    foo: "bar ${NODE_ENV}",
    baz: ["stuff", { "${NODE_ENV} key": "Look at this!" }],
    $NODE_ENV: "doesn't work",
    "${NODE_ENV }": "doesn't work either",
    "${NONEXISTENT_HOPEFULLY}": "this one does, although it may cause trouble",
  };
  expect(utils.envsubst(obj)).toEqual({
    foo: "bar test",
    baz: ["stuff", { "test key": "Look at this!" }],
    $NODE_ENV: "doesn't work",
    "${NODE_ENV }": "doesn't work either",
    "": "this one does, although it may cause trouble",
  });
});
