import HttpAgent, { HttpsAgent } from "agentkeepalive";
import axios from "axios";
import {
  HTTP_CLIENT_TIMEOUT,
  HTTP_CLIENT_MAX_REDIRECTS,
  HTTP_CLIENT_MAX_CONTENT_LENGTH,
} from "../conf";

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
