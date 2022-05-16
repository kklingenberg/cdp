import { AxiosRequestConfig, AxiosResponse, AxiosError } from "axios";
import { HTTP_CLIENT_MAX_RETRIES, HTTP_CLIENT_BACKOFF_FACTOR } from "../conf";
import {
  Event,
  makeOldEventParser,
  parseVector,
  WrapDirective,
  chooseParser,
  makeWrapper,
} from "../event";
import { makeLogger } from "../log";
import { resolveAfter, mergeHeaders } from "../utils";
import { axiosInstance } from "./axios";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("io/http-client");

/**
 * Attempt a request, and retry it if it fails with 5xx status codes.
 *
 * @param args Axios arguments.
 * @param attempt The current attempt number.
 * @returns A promise that resolves with the final response, or
 * rejects with an error.
 */
export const request = async (
  args: AxiosRequestConfig,
  attempt = 1
): Promise<AxiosResponse> => {
  try {
    return await axiosInstance.request(args);
  } catch (_err) {
    const err = _err as AxiosError;
    if (
      attempt <= HTTP_CLIENT_MAX_RETRIES &&
      err.response &&
      err.response.status >= 500 &&
      err.response.status < 600
    ) {
      logger.info(
        "Request failed with status:",
        err.response.status,
        "; retrying in ",
        HTTP_CLIENT_BACKOFF_FACTOR * 2 ** attempt,
        "seconds..."
      );
      // Apply exponential backoff.
      await resolveAfter(HTTP_CLIENT_BACKOFF_FACTOR * 1000 * 2 ** attempt);
      return await request(args, attempt + 1);
    } else {
      throw err;
    }
  }
};

/**
 * Sends events to the specified HTTP target, and ignore the response
 * contents. This is intended to be used as a 'fire and forget'
 * request sender.
 *
 * @param events The events to send away.
 * @param target The fully qualified URI of the target.
 * @param headers The headers to use with the request. Any
 * content-type header will be overwritten with
 * 'application/x-ndjson'.
 * @returns A promise that resolves successfully even in case of
 * responses with error status.
 */
export const sendEvents = (
  events: Event[],
  target: string,
  method: "POST" | "PUT" | "PATCH",
  headers: { [key: string]: string | number | boolean }
): Promise<void> =>
  request({
    url: target,
    method,
    data: events,
    transformRequest: [
      (data: Event[]) => data.map((e) => JSON.stringify(e)).join("\n") + "\n",
    ],
    headers: mergeHeaders(headers, { "Content-Type": "application/x-ndjson" }),
  }).then(
    () =>
      logger.debug(
        "sendEvents successfully forwarded",
        events.length,
        "events"
      ),
    (err) =>
      logger.warn(
        "sendEvents couldn't forward",
        events.length,
        `events: ${err}`
      )
  );

/**
 * Sends a thing of unknown shape to the specified HTTP target, and
 * ignore the response contents. This is intended to be used as a
 * 'fire and forget' request sender.
 *
 * @param thing The thing to send away.
 * @param target The fully qualified URI of the target.
 * @param headers The headers to use with the request.
 * @returns A promise that resolves successfully even in case of
 * responses with error status.
 */
export const sendThing = (
  thing: unknown,
  target: string,
  method: "POST" | "PUT" | "PATCH",
  headers: { [key: string]: string | number | boolean }
): Promise<void> =>
  request({
    url: target,
    method,
    data: thing,
    transformRequest: [
      (data) => (typeof data === "string" ? data : JSON.stringify(data)),
    ],
    headers: mergeHeaders(headers),
  }).then(
    () => logger.debug("sendThing successfully forwarded its payload"),
    (err) => logger.warn(`sendThing couldn't forward its payload: ${err}`)
  );

/**
 * Sends events to the specified HTTP target, and interpret the
 * response as events. In case of receiving a response with errors, or
 * even in case of network errors, this procedure resolves to an empty
 * event vector.
 *
 * @param events The events to send away.
 * @param pipelineName The name of the pipeline, required for parsing
 * events.
 * @param pipelineSignature The signature of the pipeline, required
 * for parsing events.
 * @param target The fully qualified URI of the target.
 * @param headers The headers to use with the request. Any
 * content-type header will be overwritten with
 * 'application/x-ndjson'.
 * @param wrap An optional wrapping directive for response data.
 * @returns A promise that resolves to the parsed events extracted
 * from the response, or an empty array if any error occurred.
 */
export const sendReceiveEvents = async (
  events: Event[],
  pipelineName: string,
  pipelineSignature: string,
  target: string,
  method: "POST" | "PUT" | "PATCH",
  headers: { [key: string]: string | number | boolean },
  wrap?: WrapDirective
): Promise<Event[]> => {
  const oldEventParser = makeOldEventParser(pipelineName, pipelineSignature);
  const parse = chooseParser(wrap);
  const wrapper = makeWrapper(wrap);
  try {
    const response = await request({
      url: target,
      method,
      data: events,
      transformRequest: [
        (data: Event[]) => data.map((e) => JSON.stringify(e)).join("\n") + "\n",
      ],
      headers: mergeHeaders(headers, {
        "Content-Type": "application/x-ndjson",
      }),
    });
    logger.debug(
      "sendReceiveEvents successfully forwarded",
      events.length,
      "events"
    );
    const responseEvents = [];
    for await (const responseThing of parse(response.data)) {
      for (const event of await parseVector(
        wrapper(responseThing),
        oldEventParser,
        "parsing HTTP response"
      )) {
        responseEvents.push(event);
      }
    }
    logger.debug(
      "sendReceiveEvents successfully received",
      responseEvents.length,
      "events"
    );
    return responseEvents;
  } catch (err) {
    logger.warn(
      "sendReceiveEvents couldn't forward",
      events.length,
      `events: ${err}`
    );
    return [];
  }
};

/**
 * Sends a thing of unknown shape to the specified HTTP target, and
 * interpret the response as events. In case of receiving a response
 * with errors, or even in case of network errors, this procedure
 * resolves to an empty event vector.
 *
 * @param thing The thing to send away.
 * @param pipelineName The name of the pipeline, required for parsing
 * events.
 * @param pipelineSignature The signature of the pipeline, required
 * for parsing events.
 * @param target The fully qualified URI of the target.
 * @param headers The headers to use with the request.
 * @param wrap An optional wrapping directive for response data.
 * @returns A promise that resolves to the parsed events extracted
 * from the response, or an empty array if any error occurred.
 */
export const sendReceiveThing = async (
  thing: unknown,
  pipelineName: string,
  pipelineSignature: string,
  target: string,
  method: "POST" | "PUT" | "PATCH",
  headers: { [key: string]: string | number | boolean },
  wrap?: WrapDirective
): Promise<Event[]> => {
  const oldEventParser = makeOldEventParser(pipelineName, pipelineSignature);
  const parse = chooseParser(wrap);
  const wrapper = makeWrapper(wrap);
  try {
    const response = await request({
      url: target,
      method,
      data: thing,
      transformRequest: [
        (data) => (typeof data === "string" ? data : JSON.stringify(data)),
      ],
      headers: mergeHeaders(headers),
    });
    logger.debug("sendReceiveThing successfully forwarded its payload");
    const responseEvents = [];
    for await (const responseThing of parse(response.data)) {
      for (const event of await parseVector(
        wrapper(responseThing),
        oldEventParser,
        "parsing HTTP response"
      )) {
        responseEvents.push(event);
      }
    }
    logger.debug(
      "sendReceiveThing successfully received",
      responseEvents.length,
      "events"
    );
    return responseEvents;
  } catch (err) {
    logger.warn(`sendReceiveThing couldn't forward its payload: ${err}`);
    return [];
  }
};
