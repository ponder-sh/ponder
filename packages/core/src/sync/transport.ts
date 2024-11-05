import type { SyncStore } from "@/sync-store/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import type { Address, Hash, Hex, Transport } from "viem";
import { custom, hexToBigInt, maxUint256 } from "viem";

const cachedMethods = [
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionReceipt",
  "eth_getBlockTransactionCount",
] as const;

type CachedMethod = (typeof cachedMethods)[number];

const isCachedMethod = (method: string): method is CachedMethod => {
  return cachedMethods.includes(method as CachedMethod);
};

export const cachedTransport = ({
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

        if (isCachedMethod(method)) {
          let request: string = undefined!;
          let blockNumber: Hex | "latest" = undefined!;

          switch (method) {
            case "eth_call": {
              const [{ data, to }, _blockNumber] = params as [
                { data: Hex; to: Hex },
                Hex | "latest",
              ];

              request = `${method as string}_${toLowerCase(to)}_${toLowerCase(data)}`;
              blockNumber = _blockNumber;
              break;
            }
            case "eth_getBalance": {
              const [address, _blockNumber] = params as [
                Address,
                Hex | "latest",
              ];

              request = `${method as string}_${toLowerCase(address)}`;
              blockNumber = _blockNumber;
              break;
            }
            case "eth_getCode": {
              const [address, _blockNumber] = params as [
                Address,
                Hex | "latest",
              ];

              request = `${method as string}_${toLowerCase(address)}`;
              blockNumber = _blockNumber;
              break;
            }
            case "eth_getStorageAt": {
              const [address, slot, _blockNumber] = params as [
                Address,
                Hex,
                Hex | "latest",
              ];

              request = `${method as string}_${toLowerCase(address)}_${toLowerCase(slot)}`;
              blockNumber = _blockNumber;
              break;
            }
            case "eth_getTransactionReceipt": {
              const [hash, _blockNumber] = params as [Hash, Hex | "latest"];

              request = `${method as string}_${toLowerCase(hash)}`;
              blockNumber = _blockNumber;
              break;
            }
            case "eth_getBlockTransactionCount": {
              const [_blockNumber] = params as [Hex | "latest"];

              request = `${method as string}_${toLowerCase(_blockNumber)}`;
              blockNumber = _blockNumber;
              break;
            }
          }

          const blockNumberBigInt =
            blockNumber === "latest" ? maxUint256 : hexToBigInt(blockNumber);

          const cachedResult = await syncStore.getRpcRequestResult({
            blockNumber: blockNumberBigInt,
            chainId: chain!.id,
            request,
          });

          if (cachedResult !== null) return cachedResult;
          else {
            const response = await requestQueue.request(body);
            await syncStore.insertRpcRequestResult({
              blockNumber: blockNumberBigInt,
              chainId: chain!.id,
              request,
              result: response as string,
            });
            return response;
          }
        } else {
          return requestQueue.request(body);
        }
      },
    });
    return c({ chain, retryCount: 0 });
  };
};
