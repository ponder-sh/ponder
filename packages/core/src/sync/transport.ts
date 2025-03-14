import type { SyncStore } from "@/sync-store/index.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Hex,
  type Transport,
  custom,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
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
          const requests = multicallData.args[0]!.map((call) => ({
            method: "eth_call",
            params: [
              {
                data: call.callData,
                to: call.target,
              },
              blockNumber,
            ],
          }));

          if (requests.length === 0) {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              // @ts-expect-error known issue in viem
              result: [[]],
            });
          }

          const cachedResults = await syncStore.getRpcRequestResults({
            requests,
            chainId: chain!.id,
          });

          const multicallResult = cachedResults.every(
            (result) => result !== undefined,
          )
            ? []
            : await requestQueue
                .request({
                  method: "eth_call",
                  params: [
                    {
                      to: params[0]!.to,
                      data: encodeFunctionData({
                        abi: multicall3Abi,
                        functionName: "aggregate3",
                        args: [
                          multicallData.args[0]!.filter(
                            (_, index) => cachedResults[index] === undefined,
                          ),
                        ],
                      }),
                    },
                    blockNumber!,
                  ],
                })
                .then((result) =>
                  decodeFunctionResult({
                    abi: multicall3Abi,
                    functionName: "aggregate3",
                    data: result,
                  }),
                );

          // Note: insertRpcRequestResults errors can be ignored and not awaited, since
          // the response is already fetched.
          syncStore
            .insertRpcRequestResults({
              requests: requests
                .filter((_, index) => cachedResults[index] === undefined)
                .map((request, index) => ({
                  request,
                  result: multicallResult[index]!,
                }))
                // Note: we don't cache request that failed or returned "0x". See more about "0x" below.
                .filter(
                  ({ result }) => result?.success && result.returnData !== "0x",
                )
                .map(({ request, result }) => ({
                  request,
                  blockNumber:
                    blockNumber === undefined
                      ? undefined
                      : blockNumber === "latest"
                        ? 0
                        : hexToNumber(blockNumber),
                  result: JSON.stringify(result.returnData),
                })),
              chainId: chain!.id,
            })
            .catch(() => {});

          // Note: at this point, it is an invariant that either `allowFailure` is true or
          // there are no failed requests.

          let multicallIndex = 0;

          return encodeFunctionResult({
            abi: multicall3Abi,
            functionName: "aggregate3",
            result: [
              // @ts-expect-error known issue in viem
              cachedResults.map((result) => {
                if (result === undefined) {
                  return multicallResult[multicallIndex++]!;
                }
                return {
                  success: true,
                  returnData: JSON.parse(result) as Hex,
                };
              }),
            ],
          });
        } else if (
          blockDependentMethods.has(method) ||
          nonBlockDependentMethods.has(method)
        ) {
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

          const [cachedResult] = await syncStore.getRpcRequestResults({
            requests: [body],
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
            // Note: "0x" is a valid response for some requests, but is sometimes erroneously returned by the RPC.
            // Because the frequency of these valid requests with no return data is very low, we don't cache it.
            if (response !== "0x") {
              // Note: insertRpcRequestResults errors can be ignored and not awaited, since
              // the response is already fetched.
              syncStore
                .insertRpcRequestResults({
                  requests: [
                    {
                      request: body,
                      blockNumber:
                        blockNumber === undefined
                          ? undefined
                          : blockNumber === "latest"
                            ? 0
                            : hexToNumber(blockNumber),
                      result: JSON.stringify(response),
                    },
                  ],
                  chainId: chain!.id,
                })
                .catch(() => {});
            }
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
