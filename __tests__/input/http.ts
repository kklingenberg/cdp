import axios from "axios";
import { make } from "../../src/input/http";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("The http input form works as expected", async () => {
  // Arrange
  const [channel] = make("irrelevant", "irrelevant", {
    endpoint: "/events",
    port: 30001,
  });
  const events = [
    { n: "foo", d: "fooo" },
    { n: "bar", d: "barr" },
    { n: "baz", d: "bazz" },
  ];
  // Act
  const sent = channel.send();
  const eventsResponse = await axios.post(
    "http://127.0.0.1:30001/events",
    events.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  const healthResponse = await axios.get("http://127.0.0.1:30001/healthz");
  const notFoundResponse = await axios.get(
    "http://127.0.0.1:30001/loremipsum",
    { validateStatus: null }
  );
  const [output] = await Promise.all([
    consume(channel.receive),
    channel.close().then(() => resolveAfter(700)),
  ]);
  // Assert
  expect(sent).toEqual(false);
  expect(eventsResponse.status).toEqual(204);
  expect(healthResponse.status).toEqual(200);
  expect(healthResponse.data?.status).toEqual("pass");
  expect(notFoundResponse.status).toEqual(404);
  expect(output.map((e) => e.toJSON()).map(({ n, d }) => ({ n, d }))).toEqual(
    events
  );
});
