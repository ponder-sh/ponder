import { createQueue } from "@ponder/common";
import { type Transport, type TransportConfig, createTransport } from "viem";

/**
 * @description Creates a rate limited transport that throttles request throughput.
 */
export const rateLimit = (
  _transport: Transport,
  {
    requestsPerSecond,
    browser = true,
  }: { requestsPerSecond: number; browser?: boolean },
): Transport => {
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
      worker: (body: {
        method: string;
        params?: unknown;
      }) => {
        return transport.request(body);
      },
    });

    return createTransport({
      key: "rateLimit",
      name: "Rate Limit",
      request: (body) => {
        return queue.add(body);
      },
      retryCount,
      type: "rateLimit",
    } as TransportConfig);
  };
};
