import { Readable } from "stream";
import { parse } from "../../src/io/read-stream";

// Some of these tests use the fact that the default value for
// PARSE_BUFFER_SIZE is 32 when the test environment is
// active. Changing that value explicitly will break them.

/**
 * Consume an async generator. This is used in all of the following
 * tests to compare results with the expected values.
 */
const consume = async (
  generator: AsyncGenerator<unknown>
): Promise<unknown[]> => {
  const values = [];
  for await (const value of generator) {
    values.push(value);
  }
  return values;
};

// Tests start here.

test("An empty stream can be parsed", async () => {
  const stream = Readable.from([]);
  expect(await consume(parse(stream))).toEqual([]);
});

test("A singleton stream can be parsed", async () => {
  const stream = Readable.from(["{}"]);
  expect(await consume(parse(stream))).toEqual([{}]);
});

test("A non-singleton stream can be parsed", async () => {
  const stream = Readable.from([
    ' {"hello": "world"}\n{"goodbye":',
    '"world"}',
  ]);
  expect(await consume(parse(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});

test("A windows-style line-break is harmless", async () => {
  const stream = Readable.from([
    ' {"hello": "world"}\r\n{"goodbye":',
    '"world"}',
  ]);
  expect(await consume(parse(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});

test("A trailing line break is harmless", async () => {
  const stream = Readable.from([
    '{"hello": "world"}\n{"goodbye":',
    '"world"}\n',
  ]);
  expect(await consume(parse(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});

test("Objects exceeding the parse buffer size limit are dropped", async () => {
  const stream = Readable.from([
    '{"hello": "world"}\n{"goodbye":',
    '"world", "this": "will be dropped because it exceeds 32 bytes',
    '..."}\n{"what": "just happened?"}',
  ]);
  expect(await consume(parse(stream))).toEqual([
    { hello: "world" },
    { what: "just happened?" },
  ]);
});

test("Lines containing invalid JSON are dropped", async () => {
  const stream = Readable.from([
    '{"hello": "world"}\nfoobarbaz',
    "lorem\n{",
    '"something": "is missing"} \nipsum',
  ]);
  expect(await consume(parse(stream))).toEqual([
    { hello: "world" },
    { something: "is missing" },
  ]);
});

test("Limited streams don't read past their limit", async () => {
  const data = [
    '{"hello": "world"}\n{"goodbye":',
    '"world"}\n{"just": "kidding"}',
  ];
  let stream = Readable.from(data);
  expect(await consume(parse(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
    { just: "kidding" },
  ]);
  stream = Readable.from(data);
  expect(await consume(parse(stream, 38))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});
