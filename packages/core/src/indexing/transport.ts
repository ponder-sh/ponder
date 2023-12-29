import type { Address, Hex, Transport } from "viem";
import { custom, hexToBigInt, hexToNumber, maxUint256 } from "viem";

import type { SyncStore } from "@/sync-store/store.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { RequestQueue } from "@/utils/requestQueue.js";

const cachedMethods = [
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
] as const;

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

        if (cachedMethods.includes(method)) {
          let request: string = undefined!;
          let blockNumber: Hex | "latest" = undefined!;

          if (method === "eth_call") {
            const [{ data, to }, _blockNumber] = params as [
              { data: Hex; to: Hex },
              Hex | "latest",
            ];

            request = `${method as string}_${toLowerCase(to)}_${toLowerCase(
              data,
            )}`;
            blockNumber = _blockNumber;
          } else if (method === "eth_getBalance") {
            const [address, _blockNumber] = params as [Address, Hex | "latest"];

            request = `${method as string}_${toLowerCase(address)}`;
            blockNumber = _blockNumber;
          } else if (method === "eth_getCode") {
            const [address, _blockNumber] = params as [Address, Hex | "latest"];

            request = `${method as string}_${toLowerCase(address)}`;
            blockNumber = _blockNumber;
          } else if (method === "eth_getStorageAt") {
            const [address, slot, _blockNumber] = params as [
              Address,
              Hex,
              Hex | "latest",
            ];

            request = `${method as string}_${toLowerCase(
              address,
            )}_${toLowerCase(slot)}`;
            blockNumber = _blockNumber;
          }

          const _blockNumber =
            blockNumber === "latest" ? blockNumber : hexToNumber(blockNumber);
          const blockNumberBigInt =
            blockNumber === "latest" ? maxUint256 : hexToBigInt(blockNumber);

          const cachedResult = await syncStore.getRpcRequestResult({
            blockNumber: blockNumberBigInt,
            chainId: chain!.id,
            request,
          });

          if (cachedResult?.result) return cachedResult.result;
          else {
            const response = await requestQueue.request(body, _blockNumber);
            await syncStore.insertRpcRequestResult({
              blockNumber: blockNumberBigInt,
              chainId: chain!.id,
              request,
              result: response as string,
            });
            return response;
          }
        } else {
          return requestQueue.request(body, null);
        }
      },
    });
    return c({ chain });
  };
};
