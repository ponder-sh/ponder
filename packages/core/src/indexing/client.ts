import type { Common } from "@/internal/common.js";
import type { IndexingBuild, Network, SetupEvent } from "@/internal/types.js";
import type { Event } from "@/internal/types.js";
import type { SyncStore } from "@/sync-store/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type EIP1193Parameters,
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
  toHex,
} from "viem";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";

export type CachedViemClient = {
  getClient: (network: Network) => ReadonlyClient;
  load: ({ events }: { events: Event[] }) => Promise<void>;
  clear: () => void;
  event: Event | SetupEvent | undefined;
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

/**
 * RPC request.
 */
export type Request = Pick<
  ReadContractParameters,
  "abi" | "address" | "functionName" | "args"
> & { blockNumber: bigint; chainId: number };
/**
 * Serialized RPC request for uniquely identifying a request.
 *
 * @dev Encoded from {@link Request} using `abi`.
 *
 * @example
 * "{
 *   "method": "eth_call",
 *   "params": [{"data": "0x123", "to": "0x456"}, "0x789"]
 * }"
 */
type CacheKey = string;
/**
 * Response of an RPC request.
 *
 * @example
 * "0x123"
 *
 * @example
 * ""0x123456789""
 */
type Response = string;
/**
 * Recorded RPC request pattern.
 *
 * @example
 * {
 *   "address": "args.from",
 *   "abi": [...],
 *   "functionName": "balanceOf",
 *   "args": ["log.address"],
 * }
 */
export type ProfilePattern = Pick<
  ReadContractParameters,
  "abi" | "functionName"
> & {
  address: string;
  // TODO(kyle) array and struct args
  args?: string[];
};
/**
 * Serialized {@link ProfileEntry} for unique identification.
 *
 * @example
 * "args.from_balanceOf_log.address"
 */
type ProfileKey = string;
/**
 * Event name.
 *
 * @example
 * "Erc20:Transfer"
 *
 * @example
 * "Erc20.mint()"
 */
type EventName = string;
/**
 * Metadata about RPC request patterns for each event.
 *
 * @dev Only profile "eth_call" requests.
 */
// TODO(kyle) add numerator and denominator
type Profile = Map<EventName, Map<ProfileKey, ProfilePattern>>;
/**
 * Cache of RPC responses.
 */
type Cache = Map<number, Map<CacheKey, Promise<Response>>>;

const getCacheKey = (request: EIP1193Parameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

export const createCachedViemClient = ({
  common,
  indexingBuild,
  requestQueues,
  syncStore,
}: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "networks">;
  requestQueues: RequestQueue[];
  syncStore: SyncStore;
}): CachedViemClient => {
  let event: Event | SetupEvent | undefined;
  const cache: Cache = new Map();
  const profile: Profile = new Map();

  for (const network of indexingBuild.networks) {
    cache.set(network.chainId, new Map());
  }

  const ponderActions = <
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
      }: Parameters<PonderActions[action]>[0]) => {
        // profile "readContract" action

        // TODO(kyle) args with blocknumber mismatch not recorded

        if (action === "readContract" && event && event?.type !== "setup") {
          if (profile.has(event.name) === false) {
            profile.set(event.name, new Map());
          }

          const profilePattern = recordProfilePattern({
            event,
            args: args as Omit<
              Parameters<PonderActions["readContract"]>[0],
              "blockNumber" | "cache"
            >,
          });
          if (profilePattern) {
            const profilePatternKey = getProfilePatternKey(profilePattern);
            profile.get(event.name)!.set(profilePatternKey, profilePattern);
          }
        }

        const blockNumber =
          event!.type === "setup" ? event!.block : event!.event.block.number;

        // @ts-expect-error
        return _publicActions[action]({
          ...args,
          ...(cache === "immutable"
            ? { blockTag: "latest" }
            : { blockNumber: userBlockNumber ?? blockNumber }),
        } as Parameters<ReturnType<typeof publicActions>[action]>[0]);
      };
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

  return {
    getClient(network) {
      const requestQueue =
        requestQueues[indexingBuild.networks.findIndex((n) => n === network)]!;

      return createClient({
        transport: cachedTransport({ network, requestQueue, syncStore, cache }),
        chain: network.chain,
        // @ts-expect-error overriding `readContract` is not supported by viem
      }).extend(ponderActions);
    },
    async load({ events }) {
      // Use profiling metadata + next event batch to determine which
      // rpc requests are going to be made, and preload them into the cache.

      // TODO(kyle) weight + dedupe predictions
      const prediction: Request[] = [];

      for (const event of events) {
        if (profile.has(event.name)) {
          for (const [, pattern] of profile.get(event.name)!) {
            prediction.push(recoverProfilePattern(pattern, event));
          }
        }
      }

      const chainRequests: Map<number, EIP1193Parameters[]> = new Map();
      for (const network of indexingBuild.networks) {
        chainRequests.set(network.chainId, []);
      }

      for (const request of prediction.values()) {
        chainRequests.get(request.chainId)!.push({
          method: "eth_call",
          params: [
            {
              to: request.address,
              data: encodeFunctionData({
                abi: request.abi,
                functionName: request.functionName,
                args: request.args,
              }),
            },
            toHex(request.blockNumber),
          ],
        });
      }

      let fetchCount = 0;

      for (const [chainId, requests] of chainRequests.entries()) {
        const requestQueue =
          requestQueues[
            indexingBuild.networks.findIndex((n) => n.chainId === chainId)
          ]!;

        const cachedResults = await syncStore.getRpcRequestResults({
          requests,
          chainId,
        });

        const resultPromises = requests.map((request, index) => {
          if (cachedResults[index] !== undefined) {
            return Promise.resolve(cachedResults[index]!);
          }

          // TODO(kyle) handle errors

          fetchCount++;

          return requestQueue
            .request(request as EIP1193Parameters<PublicRpcSchema>)
            .then((result) => JSON.stringify(result));
        });

        for (let i = 0; i < requests.length; i++) {
          const request = requests[i]!;
          const resultPromise = resultPromises[i]!;

          const cacheKey = getCacheKey(request);

          cache.get(chainId)!.set(cacheKey, resultPromise);
        }
      }

      if (fetchCount > 0) {
        common.logger.debug({
          service: "rpc",
          msg: `Pre-fetched ${fetchCount} RPC requests`,
        });
      }
    },
    clear() {
      cache.clear();
    },
    set event(_event: Event | undefined) {
      event = _event;
    },
  };
};

export const cachedTransport =
  ({
    network,
    requestQueue,
    syncStore,
    cache,
  }: {
    network: Network;
    requestQueue: RequestQueue;
    syncStore: SyncStore;
    cache: Cache;
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
                to: call.target,
                data: call.callData,
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

          const cacheKey = getCacheKey(body);

          if (cache.get(network.chainId)!.has(cacheKey)) {
            const cachedResult = await cache
              .get(network.chainId)!
              .get(cacheKey)!;

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
                    result: cachedResult,
                  },
                ],
                chainId: network.chainId,
              })
              .catch(() => {});

            try {
              return JSON.parse(cachedResult);
            } catch {
              return cachedResult;
            }
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
          }

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
                // TODO(kyle) this may cause some cache misses for misconfigured chains
                chainId: network.chainId,
              })
              .catch(() => {});
          }
          return response;
        } else {
          return requestQueue.request(body);
        }
      },
    })({ chain, retryCount: 0 });
