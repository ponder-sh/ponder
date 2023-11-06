import { Address, custom, Hex, Transport } from "viem";

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
        console.log(body);

        let request: string | null = null;
        let blockNumber: bigint | null = null;
        if (method === "eth_call") {
          const [{ data, to }, _blockNumber] = params as [
            { data: Hex; to: Hex },
            Hex
          ];

          request = `${method as string}_${to}_${data}`;
          blockNumber = BigInt(_blockNumber);
        } else if (method === "eth_getBalance") {
          const [address, _blockNumber] = params as [Address, Hex];

          request = `${method as string}_${address}`;
          blockNumber = BigInt(_blockNumber);
        }

        if (request !== null && blockNumber !== null) {
          const cachedResult = await eventStore.getRpcRequestResult({
            blockNumber,
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
