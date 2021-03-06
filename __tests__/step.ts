import { consume } from "./test-utils";
import { make as makeEvent } from "../src/event";
import { makeWindowingChannel } from "../src/step";
import { resolveAfter } from "../src/utils";

test("@standalone A size-1 windowed channel doesn't care about timeouts", async () => {
  // Arrange
  const channel = makeWindowingChannel({
    name: "test",
    windowMaxSize: 1,
    windowMaxDuration: 10000,
    patternMode: "pass",
    functionMode: "flatmap",
  });
  // Act
  channel.send(
    await makeEvent("test", 1, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 2, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 3, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 4, [{ i: 0, p: "test", h: "test" }])
  );
  const [values] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(values.map((x) => x.map((y) => y.data))).toEqual([[1], [2], [3], [4]]);
});

test("@standalone A windowed channel truncates the last group after being closed", async () => {
  // Arrange
  const channel = makeWindowingChannel({
    name: "test",
    windowMaxSize: 3,
    windowMaxDuration: 10000,
    patternMode: "pass",
    functionMode: "flatmap",
  });
  // Act
  channel.send(
    await makeEvent("test", 1, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 2, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 3, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 4, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 5, [{ i: 0, p: "test", h: "test" }])
  );
  const [values] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(values.map((x) => x.map((y) => y.data))).toEqual([
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
    [4, 5],
    [5],
  ]);
});

test("@standalone A windowed channel using reduce mode creates disjoint groups", async () => {
  // Arrange
  const channel = makeWindowingChannel({
    name: "test",
    windowMaxSize: 2,
    windowMaxDuration: 10000,
    patternMode: "pass",
    functionMode: "reduce",
  });
  // Act
  channel.send(
    await makeEvent("test", 1, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 2, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 3, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 4, [{ i: 0, p: "test", h: "test" }])
  );
  const [values] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(values.map((x) => x.map((y) => y.data))).toEqual([
    [1, 2],
    [3, 4],
  ]);
});

test("@standalone A windowed channel uses its timeout to produce partial groups", async () => {
  // Arrange
  const channel = makeWindowingChannel({
    name: "test",
    windowMaxSize: 2,
    windowMaxDuration: 0.01,
    patternMode: "pass",
    functionMode: "reduce",
  });
  // Act
  channel.send(
    await makeEvent("test", 1, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 2, [{ i: 0, p: "test", h: "test" }]),
    await makeEvent("test", 3, [{ i: 0, p: "test", h: "test" }])
  );
  await resolveAfter(20);
  channel.send(await makeEvent("test", 4, [{ i: 0, p: "test", h: "test" }]));
  const [values] = await Promise.all([
    consume(channel.receive),
    channel.close(),
  ]);
  // Assert
  expect(values.map((x) => x.map((y) => y.data))).toEqual([[1, 2], [3], [4]]);
});
