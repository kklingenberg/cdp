import { consume } from "../test-utils";
import { resolveAfter } from "../../src/utils";
import { closeInstances, makeChannel } from "../../src/io/jq";

afterEach(() => {
  closeInstances();
});

test("Integration with jq works as expected", async () => {
  const { send, receive } = await makeChannel(`{key: join(" ")}`);
  send(["foo", "bar", "baz"], ["lorem", "ipsum"]);
  const { value: first } = await receive.next();
  const { value: second } = await receive.next();
  expect(first).toEqual({ key: "foo bar baz" });
  expect(second).toEqual({ key: "lorem ipsum" });
});

test("Failures during processing interrupt parsing of the current payload", async () => {
  const { send, receive } = await makeChannel(`.[] | (1 / .)`);
  send([0.5, 0, 0.25], [0.5, 0.25]);
  const { value: first } = await receive.next();
  const { value: second } = await receive.next();
  const { value: third } = await receive.next();
  expect(first).toEqual(2);
  // The (1 / 0) here interrupts parsing
  // The (1 / 0.25) is never executed
  expect(second).toEqual(2);
  expect(third).toEqual(4);
});

test("Closing a jq channel ends the stream", async () => {
  const { send, receive, close } = await makeChannel(".");
  send(1, 2);
  const [valuesBeforeClosing] = await Promise.all([
    consume(receive),
    resolveAfter(100).then(close),
  ]);
  send(3);
  expect(valuesBeforeClosing).toEqual([1, 2]);
  const valuesAfterClosing = await consume(receive);
  expect(valuesAfterClosing).toEqual([]);
});
