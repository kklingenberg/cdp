import { mkdtemp, readFileSync, rm, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { make as makeEvent } from "../../src/event";
import { resolveAfter } from "../../src/utils";
import { make } from "../../src/step-functions/send-file";
import { consume } from "../test-utils";

const fixtures: {
  directory: string | null;
} = {
  directory: null,
};

beforeEach((done) => {
  mkdtemp(join(tmpdir(), "send-file-"), (err, directory) => {
    fixtures.directory = directory;
    done();
  });
});

afterEach((done) => {
  if (fixtures.directory !== null) {
    rm(fixtures.directory, { recursive: true }, (err) => done());
  } else {
    done();
  }
});

const readFile = (path: string): string => readFileSync(path, "utf-8");

test("Send-file works as expected", async () => {
  expect(fixtures.directory).not.toBeNull();
  const path = join(fixtures.directory as string, "test");
  // Arrange
  const channel = await make("irrelevant", "irrelevant", path);
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(readFile(path)).toEqual(
    JSON.stringify(events[0]) + "\n" + JSON.stringify(events[1]) + "\n"
  );
});

test("Send-stdout works when using a jq program to preprocess the data", async () => {
  expect(fixtures.directory).not.toBeNull();
  const path = join(fixtures.directory as string, "test");
  // Arrange
  const channel = await make("irrelevant", "irrelevant", {
    path,
    "jq-expr": ".[].d",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", ["world"], trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1).then(() => channel.close()),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", ["world"]]);
  // The 'hello' sent to the file is not JSON-encoded. This is expected.
  expect(readFile(path)).toEqual('hello\n["world"]\n');
});

test("Send-file doesn't overwrite file contents", async () => {
  expect(fixtures.directory).not.toBeNull();
  const path = join(fixtures.directory as string, "test");
  writeFileSync(path, "this was here before those 'events' arrived");
  // Arrange
  const channel = await make("irrelevant", "irrelevant", { path });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const events = [
    await makeEvent("a", "hello", trace),
    await makeEvent("a", "world", trace),
  ];
  // Act
  channel.send(events);
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual(["hello", "world"]);
  expect(readFile(path)).toEqual(
    "this was here before those 'events' arrived" +
      JSON.stringify(events[0]) +
      "\n" +
      JSON.stringify(events[1]) +
      "\n"
  );
});
