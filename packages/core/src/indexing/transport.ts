import { custom, Hex, Transport } from "viem";

import { EventStore } from "@/event-store/store";

export const ponderTransport = ({
  transport,
  eventStore,
}: {
  transport: Transport;
  eventStore: EventStore;
}): Transport => {
  return ({ chain }) => {
    const underlyingTransport = transport({ chain });

    const c = custom({
      async request({ method, params }) {
        const body = { method, params };
        if (method === "eth_call") {
          const [{ data, to }, blockNumber] = params as [
            { data: Hex; to: Hex },
            Hex
          ];

          const request = `${method as string}_${to}_${data}`;

          const cachedResult = await eventStore.getRpcRequestResult({
            blockNumber: BigInt(blockNumber),
            chainId: chain!.id,
            request,
          });

          if (cachedResult?.result) return cachedResult.result;
          else {
            const response = await underlyingTransport.request(body);
            await eventStore.insertRpcRequestResult({
              blockNumber: BigInt(blockNumber),
              chainId: chain!.id,
              request,
              result: response as string,
            });
            return response;
          }
        } else {
          return await underlyingTransport.request(body);
        }
      },
    });
    return c({ chain });
  };
};
