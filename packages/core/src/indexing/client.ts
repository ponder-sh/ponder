import type { Network } from "@/internal/types.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type GetBlockReturnType,
  type GetBlockTransactionCountReturnType,
  type GetTransactionCountReturnType,
  type Hash,
  type Hex,
  type MulticallParameters,
  type MulticallReturnType,
  type Prettify,
  type PublicActions,
  type PublicRpcSchema,
  type ReadContractParameters,
  type ReadContractReturnType,
  type SimulateContractParameters,
  type SimulateContractReturnType,
  type Transport,
  createClient,
  custom,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  hexToNumber,
  multicall3Abi,
  publicActions,
  toFunctionSelector,
} from "viem";

// TODO(kyle) better name
type IndexingClient = {
  getClient: (network: Network) => ReadonlyClient;
  load: () => Promise<void>;
  clear: () => void;
  event: Event | undefined;
};

const MULTICALL_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: multicall3Abi, name: "aggregate3" }),
);

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

/** Viem actions where the `block` property is optional and implicit. */
const blockDependentActions = [
  "getBalance",
  "call",
  "estimateGas",
  "getFeeHistory",
  "getProof",
  "getCode",
  "getStorageAt",
  "getEnsAddress",
  "getEnsAvatar",
  "getEnsName",
  "getEnsResolver",
  "getEnsText",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions where the `block` property is non-existent. */
const nonBlockDependentActions = [
  "getTransaction",
  "getTransactionReceipt",
  "getTransactionConfirmations",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

type BlockOptions =
  | {
      cache?: undefined;
      blockNumber?: undefined;
    }
  | {
      cache: "immutable";
      blockNumber?: undefined;
    }
  | {
      cache?: undefined;
      blockNumber: bigint;
    };

type RequiredBlockOptions =
  | {
      /** Hash of the block. */
      blockHash: Hash;
      blockNumber?: undefined;
    }
  | {
      blockHash?: undefined;
      /** The block number. */
      blockNumber: bigint;
    };

type BlockDependentAction<
  fn extends (client: any, args: any) => unknown,
  ///
  params = Parameters<fn>[0],
  returnType = ReturnType<fn>,
> = (
  args: Omit<params, "blockTag" | "blockNumber"> & BlockOptions,
) => returnType;

export type PonderActions = {
  [action in (typeof blockDependentActions)[number]]: BlockDependentAction<
    ReturnType<typeof publicActions>[action]
  >;
} & {
  multicall: <
    const contracts extends readonly unknown[],
    allowFailure extends boolean = true,
  >(
    args: Omit<
      MulticallParameters<contracts, allowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<MulticallReturnType<contracts, allowFailure>>;
  readContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    args: Omit<
      ReadContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<ReadContractReturnType<abi, functionName, args>>;
  simulateContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
    const args extends ContractFunctionArgs<
      abi,
      "nonpayable" | "payable",
      functionName
    >,
  >(
    args: Omit<
      SimulateContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions,
  ) => Promise<SimulateContractReturnType<abi, functionName, args>>;
  getBlock: <includeTransactions extends boolean = false>(
    args: {
      /** Whether or not to include transaction data in the response. */
      includeTransactions?: includeTransactions | undefined;
    } & RequiredBlockOptions,
  ) => Promise<GetBlockReturnType<Chain | undefined, includeTransactions>>;
  getTransactionCount: (
    args: {
      /** The account address. */
      address: Address;
    } & RequiredBlockOptions,
  ) => Promise<GetTransactionCountReturnType>;
  getBlockTransactionCount: (
    args: RequiredBlockOptions,
  ) => Promise<GetBlockTransactionCountReturnType>;
} & Pick<PublicActions, (typeof nonBlockDependentActions)[number]>;

export type ReadonlyClient<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
> = Prettify<
  Omit<
    Client<transport, chain, undefined, PublicRpcSchema, PonderActions>,
    | "extend"
    | "key"
    | "batch"
    | "cacheTime"
    | "account"
    | "type"
    | "uid"
    | "chain"
    | "name"
    | "pollingInterval"
    | "transport"
    | "ccipRead"
  >
>;

type CacheKey = string;
type Response = Awaited<ReturnType<RequestQueue["request"]>>;
type Cache = Map<CacheKey, Response>;

export const createIndexingClient = ({
  networks,
  requestQueues,
  syncStore,
}: {
  networks: Network[];
  requestQueues: RequestQueue[];
  syncStore: SyncStore;
}): IndexingClient => {
  let event: Event | undefined;
  const cache: Cache = new Map();

  return {
    getClient(network) {
      const requestQueue =
        requestQueues[networks.findIndex((n) => n === network)]!;

      return createClient({
        transport: cachedTransport({ network, requestQueue, syncStore }),
        chain: network.chain,
        // @ts-ignore
        // TODO(kyle) use event from block.number ??
      }).extend(ponderActions(() => blockNumber!));
    },
    async load() {},
    clear() {},
    set event(_event: Event | undefined) {
      event = _event;
    },
  };
};

export const ponderActions = (getBlockNumber: () => bigint) => {
  return <
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => {
    const actions = {} as PonderActions;
    const _publicActions = publicActions(client);

    const getPonderAction = <
      action extends
        | (typeof blockDependentActions)[number]
        | "multicall"
        | "readContract"
        | "simulateContract",
    >(
      action: action,
    ) => {
      return ({
        cache,
        blockNumber: userBlockNumber,
        ...args
      }: Parameters<PonderActions[action]>[0]) =>
        // @ts-ignore
        _publicActions[action]({
          ...args,
          ...(cache === "immutable"
            ? { blockTag: "latest" }
            : { blockNumber: userBlockNumber ?? getBlockNumber() }),
        } as Parameters<ReturnType<typeof publicActions>[action]>[0]);
    };

    const getRetryAction = (action: PonderActions[keyof PonderActions]) => {
      return async (...args: Parameters<typeof action>) => {
        const RETRY_COUNT = 3;
        for (let i = 0; i <= RETRY_COUNT; i++) {
          try {
            // @ts-ignore
            return await action(...args);
          } catch (error) {
            if (
              (error as Error)?.message?.includes("returned no data") ===
                false ||
              i === RETRY_COUNT
            ) {
              throw error;
            }
          }
        }
      };
    };

    for (const action of blockDependentActions) {
      actions[action] = getPonderAction(action);
    }

    // @ts-ignore
    actions.multicall = getRetryAction(getPonderAction("multicall"));
    // @ts-ignore
    actions.readContract = getRetryAction(getPonderAction("readContract"));
    actions.simulateContract = getRetryAction(
      // @ts-ignore
      getPonderAction("simulateContract"),
    );

    for (const action of nonBlockDependentActions) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    // required block actions

    for (const action of [
      "getBlock",
      "getBlockTransactionCount",
      "getTransactionCount",
    ]) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    return actions;
  };
};

export const cachedTransport =
  ({
    network,
    requestQueue,
    syncStore,
  }: {
    network: Network;
    requestQueue: RequestQueue;
    syncStore: SyncStore;
  }): Transport =>
  ({ chain }) =>
    custom({
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
            // empty multicall result
            return "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
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

          // Note: viem <= 2.23.6 had a bug with `encodeFunctionResult` which can be worked around by adding
          // another layer of array nesting.
          // Fixed by this commit https://github.com/wevm/viem/commit/9c442de0ff38ac1f654b5c751d292e9a9f8d574c

          const resultToEncode = cachedResults.map((result) => {
            if (result === undefined) {
              return multicallResult[multicallIndex++]!;
            }
            return {
              success: true,
              returnData: JSON.parse(result) as Hex,
            };
          });

          try {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              result: resultToEncode,
            });
          } catch (e) {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              result: [
                // @ts-expect-error known issue in viem <= 2.23.6
                resultToEncode,
              ],
            });
          }
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
                  chainId: network.chainId,
                })
                .catch(() => {});
            }
            return response;
          }
        } else {
          return requestQueue.request(body);
        }
      },
    })({ chain, retryCount: 0 });
