import { HttpRequestError, TimeoutError } from "viem";
import {
  type HttpRequestParameters,
  type HttpRequestReturnType,
  stringify,
} from "viem/utils";

export type RpcRequest = {
  jsonrpc?: "2.0" | undefined;
  method: string;
  params?: any | undefined;
  id?: number | undefined;
};

export type HttpRpcClient = {
  request<body extends RpcRequest>(
    params: HttpRequestParameters<body>,
  ): Promise<HttpRequestReturnType<body>>;
};

export function getHttpRpcClient(url: string): HttpRpcClient {
  let id = 1;
  return {
    async request(params) {
      // biome-ignore lint/suspicious/noAsyncPromiseExecutor: <explanation>
      return new Promise(async (resolve, reject) => {
        let isTimeoutRejected = false;
        const { body } = params;

        const fetchOptions = {
          ...(params.fetchOptions ?? {}),
        };

        const { headers, method } = fetchOptions;

        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const controller = new AbortController();
        const timeoutId = setTimeout(async () => {
          isTimeoutRejected = true;
          controller.abort();

          if (reader) {
            try {
              await reader.cancel("Timeout");
            } catch {}
          }
          reject(new TimeoutError({ body, url }));
        }, 10_000);

        try {
          const init: RequestInit = {
            body: stringify({
              jsonrpc: "2.0",
              id: body.id ?? id++,
              ...body,
            }),
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            method: method || "POST",
            signal: controller.signal,
          };
          const request = new Request(url, init);
          const response = await fetch(request);

          reader = response.body?.getReader()!;
          const chunks: Uint8Array[] = [];

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
            reader = undefined;
          }

          const totalLength = chunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
          );
          let offset = 0;
          const fullData = new Uint8Array(totalLength);
          for (const chunk of chunks) {
            fullData.set(chunk, offset);
            offset += chunk.length;
          }

          const text = new TextDecoder().decode(fullData);

          let data: any = text;
          try {
            data = JSON.parse(data || "{}");
          } catch (err) {
            if (response.ok) throw err;
            data = { error: data };
          }

          if (!response.ok) {
            throw new HttpRequestError({
              body,
              details: stringify(data.error) || response.statusText,
              headers: response.headers,
              status: response.status,
              url,
            });
          }

          clearTimeout(timeoutId);
          resolve(data.result);
        } catch (_error) {
          const error = _error as Error;
          clearTimeout(timeoutId);

          if (isTimeoutRejected) return;

          if (error.name === "AbortError") {
            reject(new TimeoutError({ body, url }));
          }
          if (error instanceof HttpRequestError) reject(error);
          reject(new HttpRequestError({ body, cause: error, url }));
        }
      });
    },
  };
}
