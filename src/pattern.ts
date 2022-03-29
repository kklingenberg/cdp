import { ajv } from "./utils";

/**
 * The word separator symbol.
 */
const wordSeparator = ".";

/**
 * The valid symbols that can be contained within an event's name.
 */
const eventNameCharSet = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "abcdefghijklmnopqrstuvwxyz" +
    "0123456789" +
    "-_$:" +
    wordSeparator
);

/**
 * Single word wildcard. Matches exactly one word, without checking
 * its contents.
 */
const singleWordWildCard = "*";

/**
 * Multiple word wildcard. Matches zero or more words, without
 * checking the contents of any word matched.
 */
const multipleWordWildCard = "#";

/**
 * The valid symbols that can be contained within a string pattern.
 */
const patternCharSet = new Set(eventNameCharSet)
  .add(singleWordWildCard)
  .add(multipleWordWildCard);

/**
 * Identifies a valid event name. A valid name is comprised of
 * recognized symbols and contains 'words' of at least one symbol in
 * length.
 *
 * @param name The name to test.
 * @returns Whether the given name is a valid event name.
 */
export const isValidEventName = (name: string): boolean =>
  Array.from(name).every((symbol) => eventNameCharSet.has(symbol)) &&
  name.split(wordSeparator).every((word) => word.length > 0);

/**
 * Identifies a valid string pattern. A valid string pattern is
 * comprised of recognized symbols and contains 'words' of at least
 * one symbol in length. A word may also be a single wildcard symbol,
 * which can be used to match against one event name word (using the
 * '*' wildcard), or many sequential event name words (using the '#'
 * wildcard).
 *
 * @param pattern The pattern string to test.
 * @returns Whether the given pattern string is valid.
 */
const isValidPatternString = (pattern: string): boolean =>
  Array.from(pattern).every((symbol) => patternCharSet.has(symbol)) &&
  pattern
    .split(wordSeparator)
    .every(
      (word) =>
        word.length > 0 &&
        (word.length === 1 ||
          (word.indexOf(singleWordWildCard) === -1 &&
            word.indexOf(multipleWordWildCard) === -1))
    );

/**
 * A pattern can be built from others using basic 'and', 'or' and
 * 'not' combinators.
 */
export type Pattern =
  | string
  | { and: Pattern[] }
  | { or: Pattern[] }
  | { not: Pattern };

/**
 * Provide the type definition as a JSON schema.
 */
const patternSchema = {
  anyOf: [
    { type: "string" },
    {
      type: "object",
      properties: { and: { type: "array" } },
      additionalProperties: false,
      required: ["and"],
    },
    {
      type: "object",
      properties: { or: { type: "array" } },
      additionalProperties: false,
      required: ["or"],
    },
    {
      type: "object",
      properties: { not: { anyOf: [{ type: "string" }, { type: "object" }] } },
      additionalProperties: false,
      required: ["not"],
    },
  ],
};

/**
 * Validate a pattern non-strictly, using only the schema.
 */
const validatePatternSurface = ajv.compile(patternSchema);

/**
 * Validate a pattern fully.
 *
 * @param thing A pattern object.
 * @returns Whether the given pattern object is valid.
 */
export const isValidPattern = (thing: unknown): boolean => {
  if (!validatePatternSurface(thing)) {
    return false;
  }
  const pattern = thing as Pattern;
  if (typeof pattern === "string") {
    return isValidPatternString(pattern);
  } else if ("and" in pattern) {
    return pattern.and.every(isValidPattern);
  } else if ("or" in pattern) {
    return pattern.or.every(isValidPattern);
  } else if ("not" in pattern) {
    return isValidPattern(pattern.not);
  } else {
    return false;
  }
};

/**
 * Checks that a word sequence matches a pattern-word sequence.
 *
 * @param sWords The word sequence to check.
 * @param pWords The pattern-word sequence to check against.
 * @returns Whether the words match the pattern-words.
 */
const wordsMatchPatternWords = (
  sWords: string[],
  pWords: string[]
): boolean => {
  if (sWords.length === 0 && pWords.length === 0) return true;
  if (sWords.length === 0 || pWords.length === 0) return false;
  const [sWord, ...sRest] = sWords;
  const [pWord, ...pRest] = pWords;
  if (pWord === multipleWordWildCard) {
    return (
      wordsMatchPatternWords(sRest, pWords) ||
      wordsMatchPatternWords(sRest, pRest) ||
      wordsMatchPatternWords(sWords, pRest)
    );
  } else if (pWord === singleWordWildCard) {
    return wordsMatchPatternWords(sRest, pRest);
  } else {
    return sWord === pWord && wordsMatchPatternWords(sRest, pRest);
  }
};

/**
 * Checks that a given sequence of words matches against a given
 * pattern.
 *
 * @param sWords The word sequence to check.
 * @param p The pattern to check against.
 * @returns Whether the words match the pattern.
 */
const wordsMatchPattern = (sWords: string[], p: Pattern): boolean => {
  if (typeof p === "string") {
    return wordsMatchPatternWords(sWords, p.split(wordSeparator));
  } else if ("and" in p) {
    return p.and.every((subP) => wordsMatchPattern(sWords, subP));
  } else if ("or" in p) {
    return p.or.some((subP) => wordsMatchPattern(sWords, subP));
  } else if ("not" in p) {
    return !wordsMatchPattern(sWords, p.not);
  } else {
    return false;
  }
};

/**
 * Checks that a given string matches against a given pattern.
 *
 * @param s The string to check.
 * @param p The pattern to check against.
 * @returns Whether the string matches the pattern.
 */
export const match = (s: string, p: Pattern) =>
  wordsMatchPattern(s.split(wordSeparator), p);
