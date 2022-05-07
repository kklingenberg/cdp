import fs from "fs";
import path from "path";
import { make } from "../../src/input/tail";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

let tmpFilePath = "/tmp/should-be-overwritten";

beforeEach(() => {
  const base = fs.mkdtempSync("/tmp/cdp-tests-");
  tmpFilePath = path.join(base, "tailed-file");
  const fd = fs.openSync(tmpFilePath, "a");
  fs.closeSync(fd);
});

afterEach(() => {
  fs.unlinkSync(tmpFilePath);
  fs.rmdirSync(path.dirname(tmpFilePath));
});

test("The tail input form works as expected", async () => {
  // Arrange
  const [channel] = make("irrelevant", "irrelevant", {
    path: tmpFilePath,
    wrap: { name: "test", raw: true },
  });
  await resolveAfter(100);
  const fd = fs.openSync(tmpFilePath, "a");
  fs.writeSync(fd, "Lorem ipsum\r\n");
  fs.writeSync(fd, "Dolor sit amet\n");
  fs.closeSync(fd);
  await resolveAfter(100);
  // Act
  const sent = channel.send();
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(sent).toEqual(false);
  // tail-file removes the line breaks
  expect(output.map((e) => e.data)).toEqual(["Lorem ipsum", "Dolor sit amet"]);
});
