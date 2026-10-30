import { URL } from "node:url";
import { Cause, Deferred, Effect, Queue, type Scope, Stream } from "effect";
import { WebSocket } from "ws";
import { makeLogUnsafe } from "@/internal/logger.js";
import type { Chain } from "@/internal/types.js";
import { redactError } from "@/utils/redact.js";
import {
  RpcNetworkError,
  RpcResponseError,
  RpcTimeoutError,
  type RpcTransport,
  type RpcTransportError,
} from "./transport.js";

/**
 * Transport for a JSON-RPC provider over WebSocket, which also supports
 * `eth_subscribe`.
 */
export type WebSocketTransport = RpcTransport & {
  /**
   * Subscribe with `eth_subscribe` and `params`. Closing the scope sends
   * `eth_unsubscribe`.
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

/** The connection closed without an error. */
export class WebSocketClosedError extends Error {
  override name = "WebSocketClosedError";

  constructor() {
    super("WebSocket connection closed.");
  }
}

type Pending = {
  method: string;
  resume: (effect: Effect.Effect<unknown, RpcTransportError>) => void;
  /** Runs synchronously with the result, before the request resumes. */
  onResult?: (result: unknown) => void;
};

/**
 * Transport for a JSON-RPC provider over WebSocket.
 *
 * @dev Requests and subscriptions share one connection, which opens on demand
 * and reopens on the next request after it closes. Closing the connection
 * fails the requests and subscriptions on it. The connection closes when the
 * scope closes.
 */
export const makeWebSocketTransport = (
  url: string,
  { chain, timeout = 10_000 }: { chain: Chain; timeout?: number },
): Effect.Effect<WebSocketTransport, never, Scope.Scope> =>
  Effect.gen(function* () {
    const logUnsafe = yield* makeLogUnsafe;
    const hostname = new URL(url).hostname;
    let id = 1;
    const pending = new Map<number, Pending>();
    const subscriptions = new Map<
      string,
      Queue.Queue<unknown, RpcTransportError>
    >();
    let connection:
      | { ws: WebSocket; open: Deferred.Deferred<WebSocket, RpcNetworkError> }
      | undefined;

    /** Fail the requests and subscriptions on the connection. */
    const failAll = (cause: unknown) => {
      for (const [id, request] of pending) {
        pending.delete(id);
        request.resume(
          Effect.fail(
            new RpcNetworkError({ method: request.method, hostname, cause }),
          ),
        );
      }
      for (const [id, queue] of subscriptions) {
        subscriptions.delete(id);
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(
            new RpcNetworkError({ method: "eth_subscribe", hostname, cause }),
          ),
        );
      }
    };

    const onMessage = (ws: WebSocket, data: Buffer) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch (cause) {
        failAll(cause);
        ws.close();
        return;
      }

      if (message?.id !== undefined && message?.id !== null) {
        const request = pending.get(message.id);
        // Note: The request timed out or was interrupted.
        if (request === undefined) return;
        pending.delete(message.id);

        if (message.error) {
          request.resume(
            Effect.fail(
              new RpcResponseError({
                method: request.method,
                hostname,
                code: message.error.code,
                details: String(message.error.message),
                data: message.error.data,
              }),
            ),
          );
        } else {
          request.onResult?.(message.result);
          request.resume(Effect.succeed(message.result));
        }
        return;
      }

      const queue =
        message?.method === "eth_subscription"
          ? subscriptions.get(message.params?.subscription)
          : undefined;
      if (queue === undefined) {
        logUnsafe(
          Effect.logWarning({
            msg: "Received unrecognized JSON-RPC WebSocket message",
            chain: chain.name,
            websocket_message: message,
          }),
        );
        return;
      }
      Queue.offerUnsafe(queue, message.params.result);
    };

    const connect = (method: string) =>
      Effect.suspend(() => {
        if (connection === undefined) {
          const ws = new WebSocket(url);
          const open = Deferred.makeUnsafe<WebSocket, RpcNetworkError>();
          const current = { ws, open };
          connection = current;

          ws.on("open", () => {
            logUnsafe(
              Effect.logDebug({
                msg: "Created JSON-RPC WebSocket connection",
                chain: chain.name,
                chain_id: chain.id,
              }),
            );
            Deferred.doneUnsafe(open, Effect.succeed(ws));
          });
          ws.on("message", (data: Buffer) => onMessage(ws, data));
          ws.on("error", (error) => {
            const cause = redactError(error);
            Deferred.doneUnsafe(
              open,
              Effect.fail(new RpcNetworkError({ method, hostname, cause })),
            );
            failAll(cause);
          });
          ws.on("close", () => {
            if (connection === current) connection = undefined;
            logUnsafe(
              Effect.logDebug({
                msg: "Closed JSON-RPC WebSocket connection",
                chain: chain.name,
                chain_id: chain.id,
              }),
            );
            const cause = new WebSocketClosedError();
            Deferred.doneUnsafe(
              open,
              Effect.fail(new RpcNetworkError({ method, hostname, cause })),
            );
            failAll(cause);
          });
        }

        return Deferred.await(connection.open);
      });

    /** Send a request on `ws` and wait for its response. */
    const send = (
      ws: WebSocket,
      method: string,
      params: unknown,
      onResult?: (result: unknown) => void,
    ) =>
      Effect.callback<unknown, RpcTransportError>((resume) => {
        const requestId = id++;
        pending.set(requestId, { method, resume, onResult });
        ws.send(
          JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
          (cause) => {
            if (cause === undefined || cause === null) return;
            if (pending.delete(requestId)) {
              resume(
                Effect.fail(new RpcNetworkError({ method, hostname, cause })),
              );
            }
          },
        );
        return Effect.sync(() => {
          pending.delete(requestId);
        });
      });

    const withTimeout =
      (method: string) =>
      <A>(effect: Effect.Effect<A, RpcTransportError>) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(new RpcTimeoutError({ method, hostname, timeout })),
          }),
        );

    // Note: Wait for the connection to close, so its log is written before
    // the scope finishes closing.
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        const current = connection;
        if (current === undefined) return Effect.void;
        return Effect.callback<void>((resume) => {
          if (current.ws.readyState === WebSocket.CLOSED) {
            resume(Effect.void);
            return;
          }
          current.ws.once("close", () => resume(Effect.void));
          current.ws.close();
        }).pipe(Effect.timeoutOption(1_000), Effect.asVoid);
      }),
    );

    return {
      hostname,
      request: (body) =>
        connect(body.method).pipe(
          Effect.flatMap((ws) => send(ws, body.method, body.params)),
          withTimeout(body.method),
        ),
      subscribe: (params) =>
        Effect.gen(function* () {
          const queue = yield* Queue.unbounded<unknown, RpcTransportError>();
          const ws = yield* connect("eth_subscribe");
          // Note: Notifications can arrive right after the response, so the
          // subscription is added before the request resumes.
          const subscriptionId = (yield* send(
            ws,
            "eth_subscribe",
            params,
            (result) => {
              subscriptions.set(result as string, queue);
            },
          ).pipe(withTimeout("eth_subscribe"))) as string;

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              subscriptions.delete(subscriptionId);
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id: id++,
                    method: "eth_unsubscribe",
                    params: [subscriptionId],
                  }),
                );
              }
            }),
          );

          return {
            id: subscriptionId,
            notifications: Stream.fromQueue(queue),
          };
        }),
    } satisfies WebSocketTransport;
  });
