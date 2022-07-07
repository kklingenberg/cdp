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

test("@standalone Signatures can be obtained for any JSON-encodable thing", async () => {
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

test("@standalone Signatures can't be generated for non JSON-encodable things", async () => {
  await expect(utils.getSignature(undefined)).rejects.toThrow();
});

test("@standalone Signatures are distinct", async () => {
  const s1 = await utils.getSignature("foo", "bar");
  const s2 = await utils.getSignature("foobar");
  const s3 = await utils.getSignature("foo", undefined, "bar");
  expect(s1).not.toEqual(s2);
  expect(s1).not.toEqual(s3);
  expect(s2).not.toEqual(s3);
});

test("@standalone Environment variables can be replaced in objects", () => {
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

test("@standalone Fuses can guard a single executor at a time", async () => {
  // Arrange
  const openFuse = utils.makeFuse();
  const triggeredFuse = utils.makeFuse();
  // Act & assert
  // Simple guards work if awaited
  await openFuse.guard((resolve) => setTimeout(resolve, 200));
  await openFuse.guard((resolve) => setTimeout(resolve, 200));
  // Multiple guards work if the fuse is triggered in-between guards.
  const guarded = triggeredFuse.guard((resolve) => {
    // Never resolve
  });
  triggeredFuse.trigger();
  await Promise.all([
    guarded,
    triggeredFuse.guard((resolve) => {
      // Never resolve
    }),
  ]);
  // Multiple guards fail if awaited on in parallel.
  await expect(
    Promise.all([
      openFuse.guard((resolve) => setTimeout(resolve, 200)),
      openFuse.guard((resolve) => setTimeout(resolve, 200)),
    ])
  ).rejects.toThrow("a previous guard is still in place");
});
