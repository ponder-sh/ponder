import { Data, Effect, type Scope, type Stream } from "effect";
import type { EIP1193RequestFn } from "viem";
import { redactError } from "@/utils/redact.js";
import type { RequestParameters, RpcSchema } from "./index.js";

/**
 * Sends one JSON-RPC request to one provider. A transport does not retry or
 * select a provider.
 */
export type RpcTransport = {
  hostname: string;
  /**
   * Send `body` with the request id `requestId`. Fails with an
   * {@link RpcTransportError}, or with the error that a custom transport throws.
   */
  request: (
    body: RequestParameters,
    requestId: string,
  ) => Effect.Effect<unknown, Error>;
};

/** The request did not get a response (DNS, connection, TLS, reset, closed socket). */
export class RpcNetworkError extends Data.TaggedError("RpcNetworkError")<{
  method: string;
  hostname: string;
  cause: unknown;
}> {
  override get message() {
    const cause =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Failed '${this.method}' request to ${this.hostname}: ${cause}`;
  }
}

/**
 * The provider replied, but not with a JSON-RPC result or error: a non-2xx
 * status, or a body that is not JSON.
 */
export class RpcHttpError extends Data.TaggedError("RpcHttpError")<{
  method: string;
  hostname: string;
  status: number;
  body: string;
}> {
  override get message() {
    const body =
      this.body.length > 200 ? `${this.body.slice(0, 200)}...` : this.body;
    return `Failed '${this.method}' request to ${this.hostname} with HTTP ${this.status}${body === "" ? "" : `: ${body}`}`;
  }
}

/**
 * The provider replied with a JSON-RPC error object.
 *
 * @dev `code` and `data` are top-level properties, like viem's RPC errors, so
 * range error parsing and revert decoding read them.
 */
export class RpcResponseError extends Data.TaggedError("RpcResponseError")<{
  method: string;
  hostname: string;
  code: number;
  /** The `message` of the JSON-RPC error. */
  details: string;
  data?: unknown;
}> {
  override get message() {
    return `Failed '${this.method}' request to ${this.hostname}: ${this.details} (code ${this.code})`;
  }
}

/** The request did not complete in time. */
export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  method: string;
  hostname: string;
  timeout: number;
}> {
  override get message() {
    return `Failed '${this.method}' request to ${this.hostname}: timed out after ${this.timeout}ms`;
  }
}

export type RpcTransportError =
  | RpcNetworkError
  | RpcHttpError
  | RpcResponseError
  | RpcTimeoutError;

/**
 * Transport for a custom viem transport from `ponder.config.ts`.
 *
 * @dev Failures are the errors that the custom transport throws, with the
 * URLs in them redacted.
 */
export const makeCustomTransport = (
  request: EIP1193RequestFn<RpcSchema>,
): RpcTransport => ({
  hostname: "custom_transport",
  request: (body) =>
    Effect.tryPromise({
      try: () => request(body),
      catch: (error) => redactError(error as Error),
    }),
});

/**
 * A connection that can subscribe with `eth_subscribe`, such as a WebSocket.
 */
export type RpcSubscribeTransport = {
  hostname: string;
  /**
   * Subscribe with `eth_subscribe` and `params`. Closing the scope
   * unsubscribes.
   *
   * @returns The subscription id, and the stream of notification results,
   * which fails when the connection closes.
   */
  subscribe: (params: unknown[]) => Effect.Effect<
    {
      id: string;
      notifications: Stream.Stream<unknown, RpcTransportError>;
    },
    RpcTransportError,
    Scope.Scope
  >;
};
