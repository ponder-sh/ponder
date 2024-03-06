import { type Transport, type TransportConfig, createTransport } from "viem";

/**
 * Load balanced transport for Viem spreading requests between child transports using a round robin algorithm.
 */
export const loadBalancedTransport = (_transports: Transport[]): Transport => {
  return ({ chain, retryCount, timeout }) => {
    const transports = _transports.map((t) =>
      chain === undefined
        ? t({ retryCount: 0, timeout })
        : t({ chain, retryCount: 0, timeout }),
    );

    let index = 0;

    return createTransport({
      key: "load",
      name: "Load balanced transport",
      request: (body) => {
        const response = transports[index++]!.request(body);
        if (index === transports.length) index = 0;

        return response;
      },
      retryCount,
      timeout,
      type: "load-balance",
    } as TransportConfig);
  };
};
