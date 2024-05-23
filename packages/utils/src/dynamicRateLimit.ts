import { createQueue } from "@ponder/common";
import {
  RpcError,
  type Transport,
  type TransportConfig,
  createTransport,
} from "viem";

/**
 * @description Creates a rate limited transport that throttles request throughput.
 */
export const dynamicRateLimit = (
  _transport: Transport,
  {
    initialRequestsPerSecond = 20,
    browser = true,
  }: { initialRequestsPerSecond?: number; browser?: boolean },
): Transport => {
  let requestsPerSecond = initialRequestsPerSecond;
  let requests = 0;
  let timestamp = 0;
  let rangeHas429 = false;

  return ({ chain, retryCount, timeout }) => {
    const transport =
      chain === undefined
        ? _transport({ retryCount: 0, timeout })
        : _transport({ chain, retryCount: 0, timeout });

    const queue = createQueue({
      frequency: requestsPerSecond,
      concurrency: Math.ceil(requestsPerSecond / 4),
      initialStart: true,
      browser,
      worker: async (body: {
        method: string;
        params?: unknown;
      }) => {
        const _timestamp = Date.now();

        if (Math.floor(_timestamp / 1_000) !== timestamp) {
          if (rangeHas429) {
            // Note: do not want requests per second < 1
            requestsPerSecond = Math.ceil(requests * 0.75);
          } else {
            requestsPerSecond *= Math.max(
              requestsPerSecond,
              Math.ceil(requests * 1.05),
            );
          }

          queue.setParameters({
            frequency: requestsPerSecond,
            concurrency: Math.ceil(requestsPerSecond / 4),
          });

          requests = 0;
          timestamp = Math.floor(_timestamp / 1_000);
          rangeHas429 = false;
        }

        requests++;

        try {
          return await transport.request(body);
        } catch (_error) {
          const error = _error as RpcError;

          if (error.code === 429) {
            rangeHas429 = true;
            // Note: should we retry the request automatically
          }

          throw error;
        }
      },
    });

    return createTransport({
      key: "dynamicRateLimit",
      name: "Dynamic Rate Limit",
      request: async (body) => {
        return await queue.add(body);
      },
      retryCount,
      type: "dynamicRateLimit",
    } as TransportConfig);
  };
};
