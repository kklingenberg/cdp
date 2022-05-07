import { make } from "../../src/input/generator";
import { resolveAfter } from "../../src/utils";
import { consume } from "../test-utils";

test("The generator input form works as expected", async () => {
  // Arrange
  const [channel] = make("irrelevant", "irrelevant", {
    name: "test",
    seconds: 0.19,
  });
  // Act
  const sent = channel.send();
  const [output] = await Promise.all([
    consume(channel.receive),
    resolveAfter(1000).then(() => channel.close()),
  ]);
  // Assert
  expect(sent).toEqual(false);
  expect(output).toHaveLength(5);
});
