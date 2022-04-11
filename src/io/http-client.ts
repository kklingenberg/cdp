import HttpAgent, { HttpsAgent } from "agentkeepalive";
import axios from "axios";
import {
  HTTP_CLIENT_TIMEOUT,
  HTTP_CLIENT_MAX_REDIRECTS,
  HTTP_CLIENT_MAX_CONTENT_LENGTH,
} from "../conf";
import { Event, makeOldEventParser, parseVector, makeWrapper } from "../event";
import { makeLogger } from "../utils";
import { parse } from "./read-stream";

/**
 * A logger instance namespaced to this module.
 */
const logger = makeLogger("io/http-client");

/**
 * The axios instance used to emit all http requests.
 */
export const axiosInstance = axios.create({
  timeout: HTTP_CLIENT_TIMEOUT,
  httpAgent: new HttpAgent(),
  httpsAgent: new HttpsAgent(),
  maxRedirects: HTTP_CLIENT_MAX_REDIRECTS,
  maxContentLength: HTTP_CLIENT_MAX_CONTENT_LENGTH,
  responseType: "stream",
});

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
  headers: { [key: string]: string | number | boolean }
): Promise<void> =>
  axiosInstance
    .post(target, events, {
      transformRequest: [
        (data: Event[]) => data.map((e) => JSON.stringify(e)).join("\n") + "\n",
      ],
      headers: { ...headers, "Content-Type": "application/x-ndjson" },
    })
    .then(
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
          "events:",
          err
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
  headers: { [key: string]: string | number | boolean }
): Promise<void> =>
  axiosInstance
    .post(target, thing, {
      transformRequest: [
        (data) => (typeof data === "string" ? data : JSON.stringify(data)),
      ],
      headers,
    })
    .then(
      () => logger.debug("sendThing successfully forwarded its payload"),
      (err) => logger.warn("sendThing couldn't forward its payload:", err)
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
 * @param wrap An optional event name in case the response is to be
 * wrapped in a brand-new event envelope.
 * @returns A promise that resolves to the parsed events extracted
 * from the response, or an empty array if any error occurred.
 */
export const sendReceiveEvents = async (
  events: Event[],
  pipelineName: string,
  pipelineSignature: string,
  target: string,
  headers: { [key: string]: string | number | boolean },
  wrap?: string
): Promise<Event[]> => {
  const oldEventParser = makeOldEventParser(pipelineName, pipelineSignature);
  const wrapper = makeWrapper(wrap);
  try {
    const response = await axiosInstance.post(target, events, {
      transformRequest: [
        (data: Event[]) => data.map((e) => JSON.stringify(e)).join("\n") + "\n",
      ],
      headers: { ...headers, "Content-Type": "application/x-ndjson" },
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
      "events:",
      err
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
 * @param wrap An optional event name in case the response is to be
 * wrapped in a brand-new event envelope.
 * @returns A promise that resolves to the parsed events extracted
 * from the response, or an empty array if any error occurred.
 */
export const sendReceiveThing = async (
  thing: unknown,
  pipelineName: string,
  pipelineSignature: string,
  target: string,
  headers: { [key: string]: string | number | boolean },
  wrap?: string
): Promise<Event[]> => {
  const oldEventParser = makeOldEventParser(pipelineName, pipelineSignature);
  const wrapper = makeWrapper(wrap);
  try {
    const response = await axiosInstance.post(target, thing, {
      transformRequest: [
        (data) => (typeof data === "string" ? data : JSON.stringify(data)),
      ],
      headers,
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
    logger.warn("sendReceiveThing couldn't forward its payload:", err);
    return [];
  }
};
