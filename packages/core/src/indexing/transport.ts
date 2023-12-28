import type { Address, Hex, Transport } from "viem";
import { custom, maxUint256 } from "viem";

import type { SyncStore } from "@/sync-store/store.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { RequestQueue } from "@/utils/requestQueue.js";

export const ponderTransport = ({
  requestQueue,
  syncStore,
}: {
  requestQueue: RequestQueue;
  syncStore: SyncStore;
}): Transport => {
  return ({ chain }) => {
    const c = custom({
      async request({ method, params }) {
        const body = { method, params };

        let request: string | null = null;
        let blockNumber: bigint | null = null;
        if (method === "eth_call") {
          const [{ data, to }, _blockNumber] = params as [
            { data: Hex; to: Hex },
            Hex | "latest",
          ];

          request = `${method as string}_${toLowerCase(to)}_${toLowerCase(
            data,
          )}`;
          blockNumber =
            _blockNumber === "latest" ? maxUint256 : BigInt(_blockNumber);
        } else if (method === "eth_getBalance") {
          const [address, _blockNumber] = params as [Address, Hex | "latest"];

          request = `${method as string}_${toLowerCase(address)}`;
          blockNumber =
            _blockNumber === "latest" ? maxUint256 : BigInt(_blockNumber);
        } else if (method === "eth_getCode") {
          const [address, _blockNumber] = params as [Address, Hex | "latest"];

          request = `${method as string}_${toLowerCase(address)}`;
          blockNumber =
            _blockNumber === "latest" ? maxUint256 : BigInt(_blockNumber);
        } else if (method === "eth_getStorageAt") {
          const [address, slot, _blockNumber] = params as [
            Address,
            Hex,
            Hex | "latest",
          ];

          request = `${method as string}_${toLowerCase(address)}_${toLowerCase(
            slot,
          )}`;
          blockNumber =
            _blockNumber === "latest" ? maxUint256 : BigInt(_blockNumber);
        }

        if (request !== null && blockNumber !== null) {
          const cachedResult = await syncStore.getRpcRequestResult({
            blockNumber,
            chainId: chain!.id,
            request,
          });

          if (cachedResult?.result) return cachedResult.result;
          else {
            const response = await requestQueue.request("realtime", body);
            await syncStore.insertRpcRequestResult({
              blockNumber: blockNumber,
              chainId: chain!.id,
              request,
              result: response as string,
            });
            return response;
          }
        } else {
          return await requestQueue.request("realtime", body);
        }
      },
    });
    return c({ chain });
  };
};
