/* eslint-disable @typescript-eslint/ban-ts-comment */
import fetch, { Headers, Request, Response } from "node-fetch";

/**
 * Set up a fetch polyfill for test runs using Node <16.
 */
if (!globalThis.fetch) {
  //@ts-ignore
  globalThis.fetch = fetch;
  //@ts-ignore
  globalThis.Headers = Headers;
  //@ts-ignore
  globalThis.Request = Request;
  //@ts-ignore
  globalThis.Response = Response;
}
