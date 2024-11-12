import type { SyncStore } from "@/sync-store/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import type { Hex, Transport } from "viem";
import { custom, hexToBigInt, maxUint256 } from "viem";

/** RPC methods that reference a block. */
const blockDependentMethods = new Set([
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByNumber",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_getProof",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getUncleByBlockNumberAndIndex",
]);

/** RPC methods that don't reference a block. */
const nonBlockDependentMethods = new Set([
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getBlockTransactionCountByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionConfirmations",
  "eth_getTransactionReceipt",
  "eth_getUncleByBlockHashAndIndex",
  "eth_getUncleCountByBlockHash",
]);

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

        if (
          blockDependentMethods.has(method) ||
          nonBlockDependentMethods.has(method)
        ) {
          const request = toLowerCase(JSON.stringify(orderObject(body)));
          let blockNumber: Hex | "latest" | undefined = undefined;

          switch (method) {
            case "eth_getBlockByNumber":
            case "eth_getBlockTransactionCountByNumber":
            case "eth_getTransactionByBlockNumberAndIndex":
            case "eth_getUncleByBlockNumberAndIndex":
              [blockNumber] = params;
              break;
            case "eth_getBalance":
            case "eth_call":
            case "eth_getCode":
            case "eth_estimateGas":
            case "eth_feeHistory":
            case "eth_getTransactionCount":
              [, blockNumber] = params;
              break;

            case "eth_getProof":
            case "eth_getStorageAt":
              [, , blockNumber] = params;
              break;
          }

          const cacheKey = {
            chainId: chain!.id,
            request,
            blockNumber:
              blockNumber === undefined
                ? undefined
                : blockNumber === "latest"
                  ? maxUint256
                  : hexToBigInt(blockNumber),
          };

          const cachedResult = await syncStore.getRpcRequestResult(cacheKey);

          if (cachedResult !== undefined) {
            try {
              return JSON.parse(cachedResult);
            } catch {
              return cachedResult;
            }
          } else {
            const response = await requestQueue.request(body);
            await syncStore.insertRpcRequestResult({
              ...cacheKey,
              result: JSON.stringify(response),
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
