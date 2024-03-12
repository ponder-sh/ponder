import { type Transport, type TransportConfig, createTransport } from "viem";

/**
 * @description Creates a load balanced transport that spreads requests between child transports using a round robin algorithm.
 */
export const loadBalance = (_transports: Transport[]): Transport => {
  return ({ chain, retryCount, timeout }) => {
    const transports = _transports.map((t) =>
      chain === undefined
        ? t({ retryCount: 0, timeout })
        : t({ chain, retryCount: 0, timeout }),
    );

    let index = 0;

    return createTransport({
      key: "loadBalance",
      name: "Load Balance",
      request: (body) => {
        const response = transports[index++]!.request(body);
        if (index === transports.length) index = 0;

        return response;
      },
      retryCount,
      timeout,
      type: "loadBalance",
    } as TransportConfig);
  };
};
