/**
 * Consume an async generator. This is used in some tests to compare
 * results with the expected values.
 *
 * @param generator The async generator to be consumed.
 * @param maxValues An optional maximum amount of elements to consume.
 * @returns A promise resolving to the consumed values.
 */
export const consume = async <T>(
  generator: AsyncGenerator<T>,
  maxValues?: number
): Promise<T[]> => {
  let count = 0;
  const values: T[] = [];
  if (typeof maxValues !== "undefined" && count >= maxValues) {
    return Promise.resolve(values);
  }
  for await (const value of generator) {
    values.push(value);
    count++;
    if (typeof maxValues !== "undefined" && count >= maxValues) {
      return values;
    }
  }
  return values;
};

// Provide an empty test to appease jest.
test("@standalone Nothing", () => {
  // Empty test.
});
