import { Readable } from "stream";
import { consume } from "../test-utils";
import { parseLines, parseJson } from "../../src/io/read-stream";

// Some of these tests use the fact that the default value for
// PARSE_BUFFER_SIZE is 32 when the test environment is
// active. Changing that value explicitly will break them.

test("@standalone Parsing lines is kindof equivalent to splitting on linebreaks", async () => {
  const stream = Readable.from([
    "lorem\nipsum\r\ndo", // Any combination of linebreaks can be used.
    "lor\rsit\n", // Even a single carriage return.
    "\n\n\namet", // Empty lines are not considered.
  ]);
  expect(await consume(parseLines(stream))).toEqual([
    "lorem\n",
    "ipsum\r",
    "dolor\r",
    "sit\n",
    "amet",
  ]);
});

test("@standalone An empty stream can be parsed", async () => {
  const stream = Readable.from([]);
  expect(await consume(parseJson(stream))).toEqual([]);
});

test("@standalone A singleton stream can be parsed", async () => {
  const stream = Readable.from(["{}"]);
  expect(await consume(parseJson(stream))).toEqual([{}]);
});

test("@standalone A non-singleton stream can be parsed", async () => {
  const stream = Readable.from([
    ' {"hello": "world"}\n{"goodbye":',
    '"world"}',
  ]);
  expect(await consume(parseJson(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});

test("@standalone A windows-style line-break is harmless", async () => {
  const stream = Readable.from([
    ' {"hello": "world"}\r\n{"goodbye":',
    '"world"}',
  ]);
  expect(await consume(parseJson(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});

test("@standalone A trailing line break is harmless", async () => {
  const stream = Readable.from([
    '{"hello": "world"}\n{"goodbye":',
    '"world"}\n',
  ]);
  expect(await consume(parseJson(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});

test("@standalone Objects exceeding the parse buffer size limit are dropped", async () => {
  const stream = Readable.from([
    '{"hello": "world"}\n{"goodbye":',
    '"world", "this": "will be dropped because it exceeds 32 bytes',
    '..."}\n{"what": "just happened?"}',
  ]);
  expect(await consume(parseJson(stream))).toEqual([
    { hello: "world" },
    { what: "just happened?" },
  ]);
});

test("@standalone Lines containing invalid JSON are dropped", async () => {
  const stream = Readable.from([
    '{"hello": "world"}\nfoobarbaz',
    "lorem\n{",
    '"something": "is missing"} \nipsum',
  ]);
  expect(await consume(parseJson(stream))).toEqual([
    { hello: "world" },
    { something: "is missing" },
  ]);
});

test("@standalone Limited streams don't read past their limit", async () => {
  const data = [
    '{"hello": "world"}\n{"goodbye":',
    '"world"}\n{"just": "kidding"}',
  ];
  let stream = Readable.from(data);
  expect(await consume(parseJson(stream))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
    { just: "kidding" },
  ]);
  stream = Readable.from(data);
  expect(await consume(parseJson(stream, 38))).toEqual([
    { hello: "world" },
    { goodbye: "world" },
  ]);
});
