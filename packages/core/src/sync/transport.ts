import type { SyncStore } from "@/sync-store/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Hex,
  type Transport,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  hexToNumber,
  multicall3Abi,
  toFunctionSelector,
} from "viem";

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

const MULTICALL_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: multicall3Abi, name: "aggregate3" }),
);

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

        // multicall
        if (
          method === "eth_call" &&
          params[0]?.data?.startsWith(MULTICALL_SELECTOR)
        ) {
          let blockNumber: Hex | "latest" | undefined = undefined;
          [, blockNumber] = params;

          const multicallData = decodeFunctionData({
            abi: multicall3Abi,
            data: params[0]!.data,
          });
          // TODO(kyle) handle allowFailure
          const requests = multicallData.args[0]!.map((call) => ({
            method: "eth_call",
            params: [
              {
                data: call.callData,
                to: call.target,
              },
              blockNumber,
            ],
          })).map((request) =>
            toLowerCase(JSON.stringify(orderObject(request))),
          );

          const cachedResults = await Promise.all(
            requests.map((request) =>
              syncStore.getRpcRequestResult({
                request,
                chainId: chain!.id,
              }),
            ),
          );

          const results = await Promise.all(
            requests.map((request, index) =>
              cachedResults[index] === undefined
                ? requestQueue.request(JSON.parse(request))
                : cachedResults[index]!,
            ),
          );

          for (let i = 0; i < requests.length; i++) {
            const request = requests[i]!;
            const result = results[i]!;

            if (cachedResults[i] === undefined) {
              syncStore
                .insertRpcRequestResult({
                  request,
                  blockNumber:
                    blockNumber === undefined
                      ? undefined
                      : blockNumber === "latest"
                        ? 0
                        : hexToNumber(blockNumber),
                  chainId: chain!.id,
                  result: JSON.stringify(result),
                })
                .catch(() => {});
            }
          }

          return encodeFunctionResult({
            abi: multicall3Abi,
            functionName: "aggregate3",
            result: results.map((result) => ({
              success: true,
              returnData: result as Hex,
            })),
          });
        } else if (
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

          const cachedResult = await syncStore.getRpcRequestResult({
            request,
            chainId: chain!.id,
          });

          if (cachedResult !== undefined) {
            try {
              return JSON.parse(cachedResult);
            } catch {
              return cachedResult;
            }
          } else {
            const response = await requestQueue.request(body);
            // Note: insertRpcRequestResult errors can be ignored and not awaited, since
            // the response is already fetched.
            syncStore
              .insertRpcRequestResult({
                chainId: chain!.id,
                request,
                blockNumber:
                  blockNumber === undefined
                    ? undefined
                    : blockNumber === "latest"
                      ? 0
                      : hexToNumber(blockNumber),
                result: JSON.stringify(response),
              })
              .catch(() => {});
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
