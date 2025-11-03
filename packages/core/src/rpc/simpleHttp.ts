import type { Common } from "@/internal/common.js";
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

export function getHttpRpcClient(common: Common, url: string): HttpRpcClient {
  let id = 1;
  return {
    async request(params) {
      const { body } = params;

      const fetchOptions = {
        ...(params.fetchOptions ?? {}),
      };

      const { headers, method } = fetchOptions;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

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
        clearTimeout(timeoutId);

        const parseTimeoutId = setTimeout(() => {
          common.logger.warn({
            msg: "JSON-RPC response parsing is taking longer than expected",
            url,
            method: body.method,
            duration: 5_000,
          });
        }, 5_000);

        let data: any;
        if (
          response.headers.get("Content-Type")?.startsWith("application/json")
        ) {
          try {
            data = await response.json();
          } finally {
            clearTimeout(parseTimeoutId);
          }
        } else {
          try {
            data = await response.text();
          } finally {
            clearTimeout(parseTimeoutId);
          }
          try {
            data = JSON.parse(data || "{}");
          } catch (err) {
            if (response.ok) throw err;
            data = { error: data };
          }
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

        return data.result;
      } catch (_error) {
        const error = _error as Error;
        clearTimeout(timeoutId);

        if (error.name === "AbortError") {
          throw new TimeoutError({ body, url });
        }
        if (error instanceof HttpRequestError) throw error;
        throw new HttpRequestError({ body, cause: error, url });
      }
    },
  };
}
