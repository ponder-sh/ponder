import { createQueue } from "@ponder/common";
import { type Transport, type TransportConfig, createTransport } from "viem";

/**
 * @description Creates a rate limited transport that throttles request throughput.
 */
export const rateLimitedTransport = (
  _transport: Transport,
  {
    requestsPerSecond,
    browser,
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
      key: "rate",
      name: "Rate limited transport",
      request: (body) => {
        return queue.add(body);
      },
      retryCount,
      type: "rate-limit",
    } as TransportConfig);
  };
};
