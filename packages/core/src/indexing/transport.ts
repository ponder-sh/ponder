import type { Address, Hex, Transport } from "viem";
import { custom } from "viem";

import type { SyncStore } from "@/sync-store/store.js";
import { toLowerCase } from "@/utils/lowercase.js";

export const ponderTransport = ({
  transport,
  syncStore,
}: {
  transport: Transport;
  syncStore: SyncStore;
}): Transport => {
  return ({ chain }) => {
    const underlyingTransport = transport({ chain });

    const c = custom({
      async request({ method, params }) {
        const body = { method, params };

        let request: string | null = null;
        let blockNumber: bigint | null = null;
        if (method === "eth_call") {
          const [{ data, to }, _blockNumber] = params as [
            { data: Hex; to: Hex },
            Hex,
          ];

          request = `${method as string}_${toLowerCase(to)}_${toLowerCase(
            data,
          )}`;
          blockNumber = BigInt(_blockNumber);
        } else if (method === "eth_getBalance") {
          const [address, _blockNumber] = params as [Address, Hex];

          request = `${method as string}_${toLowerCase(address)}`;
          blockNumber = BigInt(_blockNumber);
        } else if (method === "eth_getCode") {
          const [address, _blockNumber] = params as [Address, Hex];

          request = `${method as string}_${toLowerCase(address)}`;
          blockNumber = BigInt(_blockNumber);
        } else if (method === "eth_getStorageAt") {
          const [address, slot, _blockNumber] = params as [Address, Hex, Hex];

          request = `${method as string}_${toLowerCase(address)}_${toLowerCase(
            slot,
          )}`;
          blockNumber = BigInt(_blockNumber);
        }

        if (request !== null && blockNumber !== null) {
          const cachedResult = await syncStore.getRpcRequestResult({
            blockNumber,
            chainId: chain!.id,
            request,
          });

          if (cachedResult?.result) return cachedResult.result;
          else {
            const response = await underlyingTransport.request(body);
            await syncStore.insertRpcRequestResult({
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
