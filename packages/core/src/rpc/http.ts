import { URL } from "node:url";
import { Effect } from "effect";
import type { Chain } from "@/internal/types.js";
import { redactError } from "@/utils/redact.js";
import {
  RpcHttpError,
  RpcNetworkError,
  RpcResponseError,
  RpcTimeoutError,
  type RpcTransport,
  type RpcTransportError,
} from "./transport.js";

/**
 * Transport for a JSON-RPC provider over HTTP.
 *
 * @dev Interrupting a request aborts the fetch.
 */
export function makeHttpTransport(
  url: string,
  { chain, timeout = 10_000 }: { chain: Chain; timeout?: number },
): RpcTransport {
  const hostname = new URL(url).hostname;
  let id = 1;

  return {
    hostname,
    request(body, requestId) {
      const { method } = body;

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let isTimeoutReadingBody = false;

      return Effect.tryPromise({
        try: async (signal) => {
          // Note: `signal` is aborted when the request is interrupted, which includes timing out.
          signal.addEventListener("abort", () => {
            if (reader) {
              isTimeoutReadingBody = true;
              reader.cancel("Timeout").catch(() => {});
            }
          });

          let response: Response;
          try {
            response = await fetch(
              new Request(url, {
                body: JSON.stringify({ jsonrpc: "2.0", id: id++, ...body }),
                headers: {
                  "Content-Type": "application/json",
                  "X-Request-ID": requestId,
                },
                method: "POST",
                signal,
              }),
            );
          } catch (cause) {
            throw new RpcNetworkError({
              method,
              hostname,
              cause: redactError(cause),
            });
          }

          const responseBody = response.body;
          if (responseBody === null) {
            throw new RpcNetworkError({
              method,
              hostname,
              cause: new Error("Response body is missing."),
            });
          }
          reader = responseBody.getReader();
          const chunks: Uint8Array[] = [];
          let totalLength = 0;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              totalLength += value.length;
            }
          } catch (cause) {
            throw new RpcNetworkError({
              method,
              hostname,
              cause: redactError(cause),
            });
          } finally {
            reader.releaseLock();
            reader = undefined;
          }

          let offset = 0;
          const fullData = new Uint8Array(totalLength);
          for (const chunk of chunks) {
            fullData.set(chunk, offset);
            offset += chunk.length;
          }

          const text = new TextDecoder().decode(fullData);

          let data: any;
          try {
            data = JSON.parse(text || "{}");
          } catch {
            throw new RpcHttpError({
              method,
              hostname,
              status: response.status,
              body: text,
            });
          }

          if (!response.ok) {
            throw new RpcHttpError({
              method,
              hostname,
              status: response.status,
              body:
                data.error === undefined
                  ? response.statusText
                  : JSON.stringify(data.error),
            });
          }

          if (data.error) {
            throw new RpcResponseError({
              method,
              hostname,
              code: data.error.code,
              details: String(data.error.message),
              data: data.error.data,
            });
          }

          return data.result as unknown;
        },
        catch: (error) =>
          error instanceof RpcNetworkError ||
          error instanceof RpcHttpError ||
          error instanceof RpcResponseError
            ? error
            : new RpcNetworkError({
                method,
                hostname,
                cause: redactError(error),
              }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.gen(function* () {
              if (isTimeoutReadingBody) {
                yield* Effect.logWarning({
                  msg: "JSON-RPC request timed out reading response body",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname,
                  request_id: requestId,
                  method,
                  request: JSON.stringify(body),
                  duration: timeout,
                });
              }

              return yield* Effect.fail<RpcTransportError>(
                new RpcTimeoutError({ method, hostname, timeout }),
              );
            }),
        }),
      );
    },
  };
}
