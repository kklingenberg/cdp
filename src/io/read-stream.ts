import { Readable } from "stream";
import { AsyncQueue } from "../async-queue";
import { PARSE_BUFFER_SIZE } from "../conf";
import { makeLogger } from "../utils";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("io/read-stream");

/**
 * Line-break bytes. They're watched for to stop the collection of
 * data and start a parsing cycle.
 */
const lineBreaks = [13, 10];

/**
 * Extracts all parseable data from 'lines' found in the given
 * buffer. The trailing data in the buffer is only considered if
 * specified by the flag. Returns the remainder that wasn't considered
 * as a buffer.
 *
 * @param buffer The buffer to read data from.
 * @param queue The queue that should receive the parsed values.
 * @param trailingData A flag indicating whether to attempt to parse
 * the trailing data.
 * @returns The remainder of bytes (an empty buffer if trailingData is
 * true).
 */
const extractLinesIntoQueue = (
  buffer: Buffer,
  queue: AsyncQueue<unknown>,
  trailingData: boolean
): Buffer => {
  let previousPosition = 0;
  for (let position = 0; position < buffer.length; position++) {
    const byte = buffer[position];
    if (lineBreaks.includes(byte)) {
      if (position > previousPosition) {
        try {
          const value = JSON.parse(
            buffer.subarray(previousPosition, position + 1).toString()
          );
          queue.push(value);
        } catch (err) {
          logger.warn("Couldn't parse input line while parsing stream");
        }
      }
      previousPosition = position + 1;
    }
  }
  if (trailingData && previousPosition < buffer.length) {
    try {
      const value = JSON.parse(buffer.subarray(previousPosition).toString());
      queue.push(value);
    } catch (err) {
      logger.warn("Couldn't parse trailing data while parsing stream");
    }
  }
  return trailingData ? Buffer.alloc(0) : buffer.subarray(previousPosition);
};

/**
 * Parse a readable stream as NDJSON, tollerating lines with
 * errors. The stream will be forcefully closed if a read limit is
 * given and it is reached. Otherwise, it will produce results until
 * the stream is closed from other causes.
 *
 * @param stream The stream to read data from.
 * @param limit An optional limit to the number of bytes to read.
 * @returns An async iterator of parsed values.
 */
export const parse = (
  stream: Readable,
  limit?: number
): AsyncGenerator<unknown> => {
  const chunks: Buffer[] = [];
  const readLimit = limit ?? null;
  let totalRead = 0;
  const queue = new AsyncQueue<unknown>();
  // Accumulate chunks, attempting to parse linebreak-delimited data.
  stream.on("data", (data) => {
    const rawData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const bytesRead =
      readLimit !== null
        ? Math.min(readLimit - totalRead, rawData.length)
        : rawData.length;
    logger.debug("Parsed stream received data:", bytesRead, "bytes");
    totalRead += bytesRead;
    chunks.push(rawData.subarray(0, bytesRead));
    const input = Buffer.concat(chunks);
    const remainder = extractLinesIntoQueue(input, queue, false);
    if (
      input.length >= PARSE_BUFFER_SIZE &&
      remainder.length === input.length
    ) {
      logger.warn(
        "Parsed stream didn't contain line breaks after the limit of",
        PARSE_BUFFER_SIZE,
        "bytes; dropping bytes to attempt a recovery"
      );
      chunks.splice(0);
    } else {
      chunks.splice(0);
      chunks.push(remainder);
    }
    if (readLimit !== null && totalRead >= readLimit) {
      logger.info("Parsed stream achieved limit", readLimit);
      stream.destroy();
    }
  });
  // Attempt to parse whatever was left.
  stream.on("end", () => {
    logger.debug("Parsed stream ended");
    extractLinesIntoQueue(Buffer.concat(chunks), queue, true);
    queue.close();
  });
  // Attempt to parse whatever was left.
  stream.on("error", (err) => {
    logger.warn("Parsed stream reported error:", new String(err));
    extractLinesIntoQueue(Buffer.concat(chunks), queue, true);
    queue.close();
  });
  return queue.iterator();
};
