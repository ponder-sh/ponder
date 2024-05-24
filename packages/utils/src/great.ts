import {
  type HttpTransport,
  type Transport,
  type TransportConfig,
  type WebSocketTransport,
  createTransport,
} from "viem";

type BaseTransport = HttpTransport | WebSocketTransport;

export const great = (
  _transport: BaseTransport | BaseTransport[],
): Transport => {
  return ({ chain, retryCount, timeout }) => {
    const transport = Array.isArray(_transport)
      ? _transport.map((t) => t({ retryCount: 0, timeout, chain }))
      : [_transport({ chain, retryCount: 0, timeout })];

    const requestTime = new Array<number>(transport.length).fill(0);
    const successfulRequests = new Array<number>(transport.length).fill(0);

    const transportIndex = new Array<number>(transport.length);
    for (let i = 0; i < transportIndex.length; i++) {
      transportIndex[i] = i;
    }

    const sort = () => {
      transportIndex.sort((ai, bi) => {
        const a =
          successfulRequests[ai] === 0
            ? 0
            : requestTime[ai]! / successfulRequests[ai]!;
        const b =
          successfulRequests[bi] === 0
            ? 0
            : requestTime[bi]! / successfulRequests[bi]!;

        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
    };

    const handleRequest = async (body: { method: string; params: unknown }) => {
      const index = transportIndex[0]!;
      const start = performance.now();

      try {
        const response = await transport[index]!.request(body);

        const duration = performance.now() - start;
        requestTime[index] += duration;
        successfulRequests[index]++;

        sort();

        return response;
      } catch (error) {
        const duration = performance.now() - start;
        requestTime[index] += duration;

        sort();

        throw error;
      }
    };

    return createTransport({
      key: "great",
      name: "Great",
      request: handleRequest,
      retryCount,
      type: "great",
    } as TransportConfig);
  };
};
