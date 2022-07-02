import axios from "axios";
import { make as makeEvent } from "../../src/event";
import { make } from "../../src/step-functions/expose-http";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("@standalone Expose-http works as expected", async () => {
  // Arrange
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    endpoint: "/events",
    port: 30000,
    responses: 2,
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const eventBatches = [
    [
      await makeEvent("a", 1, trace),
      await makeEvent("b", 2, trace),
      await makeEvent("c", 3, trace),
      await makeEvent("d", 4, trace),
    ],
    [
      await makeEvent("a", 5, trace),
      await makeEvent("b", 6, trace),
      await makeEvent("c", 7, trace),
      await makeEvent("d", 8, trace),
    ],
    [
      await makeEvent("a", 9, trace),
      await makeEvent("b", 10, trace),
      await makeEvent("c", 11, trace),
      await makeEvent("d", 12, trace),
    ],
  ];
  // Act
  eventBatches.forEach((batch) => channel.send(batch));
  const [notAvailableResponse, output, eventResponse, notFoundResponse] =
    await Promise.all([
      axios.get("http://127.0.0.1:30000/events", { validateStatus: null }),
      resolveAfter(100).then(() => consume(channel.receive)),
      resolveAfter(200).then(() =>
        axios
          .get("http://127.0.0.1:30000/events")
          .then((response) =>
            axios.get(
              "http://127.0.0.1:30000/events/" +
                response.headers.etag.slice(1, -1)
            )
          )
      ),
      axios.get("http://127.0.0.1:30000/loremipsum", { validateStatus: null }),
      resolveAfter(300)
        .then(() => channel.close())
        .then(() => resolveAfter(700)),
    ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  expect(notAvailableResponse.status).toEqual(503);
  expect(eventResponse.status).toEqual(200);
  expect(notFoundResponse.status).toEqual(404);
  expect(eventResponse.headers.etag).toBeDefined();
  expect(
    eventResponse.data.split("\n").filter((d: string) => d !== "")
  ).toEqual(
    eventBatches[eventBatches.length - 1].map((e) => JSON.stringify(e))
  );
});

test("@standalone Expose-http can transform responses using a jq filter", async () => {
  // Arrange
  const channel = await make("irrelevant", "irrelevant", "irrelevant", {
    endpoint: "/events",
    port: 30010,
    responses: 2,
    "jq-expr": ".",
  });
  const trace = [{ i: 1, p: "irrelevant", h: "irrelevant" }];
  const eventBatches = [
    [
      await makeEvent("a", 1, trace),
      await makeEvent("b", 2, trace),
      await makeEvent("c", 3, trace),
      await makeEvent("d", 4, trace),
    ],
    [
      await makeEvent("a", 5, trace),
      await makeEvent("b", 6, trace),
      await makeEvent("c", 7, trace),
      await makeEvent("d", 8, trace),
    ],
    [
      await makeEvent("a", 9, trace),
      await makeEvent("b", 10, trace),
      await makeEvent("c", 11, trace),
      await makeEvent("d", 12, trace),
    ],
  ];
  // Act
  eventBatches.forEach((batch) => channel.send(batch));
  const [output, response] = await Promise.all([
    consume(channel.receive),
    resolveAfter(100).then(() => axios.get("http://127.0.0.1:30010/events")),
    resolveAfter(300)
      .then(() => channel.close())
      .then(() => resolveAfter(700)),
  ]);
  // Assert
  expect(output.map((e) => e.data)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  expect(response.status).toEqual(200);
  expect(response.headers.etag).toBeDefined();
  expect(response.data).toEqual(
    eventBatches[eventBatches.length - 1].map((e) => e.toJSON())
  );
});
