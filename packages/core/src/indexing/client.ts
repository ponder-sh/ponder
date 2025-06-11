import type { Common } from "@/internal/common.js";
import type { Chain, IndexingBuild, SetupEvent } from "@/internal/types.js";
import type { Event } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import {
  type Abi,
  type Account,
  type Address,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionParameters,
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
  type Chain as ViemChain,
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
  getClient: (chain: Chain) => ReadonlyClient;
  prefetch: (params: {
    events: Event[];
  }) => Promise<void>;
  clear: () => void;
  event: Event | SetupEvent | undefined;
};

const MULTICALL_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: multicall3Abi, name: "aggregate3" }),
);

const SAMPLING_RATE = 10;
const DB_PREDICTION_THRESHOLD = 0.2;
const RPC_PREDICTION_THRESHOLD = 0.8;
const MAX_CONSTANT_PATTERN_COUNT = 10;

/** RPC methods that reference a block number. */
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
  "debug_traceBlockByNumber",
]);

/** RPC methods that don't reference a block number. */
const nonBlockDependentMethods = new Set([
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getBlockTransactionCountByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionConfirmations",
  "eth_getTransactionReceipt",
  "eth_getUncleByBlockHashAndIndex",
  "eth_getUncleCountByBlockHash",
  "debug_traceBlockByHash",
  "debug_traceTransaction",
  "debug_traceCall",
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
  ) => Promise<GetBlockReturnType<ViemChain | undefined, includeTransactions>>;
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
  chain extends ViemChain | undefined = ViemChain | undefined,
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
 *   "address": ["args", "from"],
 *   "abi": [...],
 *   "functionName": "balanceOf",
 *   "args": ["log", "address"],
 * }
 */
export type ProfilePattern = Pick<
  ReadContractParameters,
  "abi" | "functionName"
> & {
  address:
    | { type: "constant"; value: unknown }
    | { type: "derived"; value: string[] };
  args?: (
    | { type: "constant"; value: unknown }
    | { type: "derived"; value: string[] }
  )[];
};
/**
 * Serialized {@link ProfilePattern} for unique identification.
 *
 * @example
 * "{
 *   "address": ["args", "from"],
 *   "args": ["log", "address"],
 *   "functionName": "balanceOf",
 * }"
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
type Profile = Map<
  EventName,
  Map<
    ProfileKey,
    { pattern: ProfilePattern; hasConstant: boolean; count: number }
  >
>;
/**
 * LRU cache of {@link ProfilePattern} in {@link Profile} with constant args.
 *
 * @dev Used to determine which {@link ProfilePattern} should be evicted.
 */
type ProfileConstantLRU = Map<EventName, Set<ProfileKey>>;
/**
 * Cache of RPC responses.
 */
type Cache = Map<number, Map<CacheKey, Promise<Response | Error> | Response>>;

export const getCacheKey = (request: EIP1193Parameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

export const encodeRequest = (request: Request) => ({
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

export const decodeResponse = (response: Response) => {
  // Note: I don't actually remember why we had to add the try catch.
  try {
    return JSON.parse(response);
  } catch (error) {
    return response;
  }
};

export const createCachedViemClient = ({
  common,
  indexingBuild,
  syncStore,
  eventCount,
}: {
  common: Common;
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  syncStore: SyncStore;
  eventCount: { [eventName: string]: number };
}): CachedViemClient => {
  let event: Event | SetupEvent = undefined!;
  const cache: Cache = new Map();
  const profile: Profile = new Map();
  const profileConstantLRU: ProfileConstantLRU = new Map();

  for (const chain of indexingBuild.chains) {
    cache.set(chain.id, new Map());
  }

  const ponderActions = <
    TTransport extends Transport = Transport,
    TChain extends ViemChain | undefined = ViemChain | undefined,
    TAccount extends Account | undefined = Account | undefined,
  >(
    client: Client<TTransport, TChain, TAccount>,
  ): PonderActions => {
    const actions = {} as PonderActions;
    const _publicActions = publicActions(client);

    const addProfilePattern = ({
      pattern,
      hasConstant,
    }: { pattern: ProfilePattern; hasConstant: boolean }) => {
      const profilePatternKey = getProfilePatternKey(pattern);

      if (profile.get(event.name)!.has(profilePatternKey)) {
        profile.get(event.name)!.get(profilePatternKey)!.count++;

        if (hasConstant) {
          profileConstantLRU.get(event.name)!.delete(profilePatternKey);
          profileConstantLRU.get(event.name)!.add(profilePatternKey);
        }
      } else {
        profile
          .get(event.name)!
          .set(profilePatternKey, { pattern, hasConstant, count: 1 });

        if (hasConstant) {
          profileConstantLRU.get(event.name)!.add(profilePatternKey);
          if (
            profileConstantLRU.get(event.name)!.size >
            MAX_CONSTANT_PATTERN_COUNT
          ) {
            const firstKey = profileConstantLRU
              .get(event.name)!
              .keys()
              .next().value;
            if (firstKey) {
              profile.get(event.name)!.delete(firstKey);
              profileConstantLRU.get(event.name)!.delete(firstKey);
            }
          }
        }
      }
    };

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
        // Note: prediction only possible when block number is managed by Ponder.

        if (
          event.type !== "setup" &&
          userBlockNumber === undefined &&
          eventCount[event.name]! % SAMPLING_RATE === 1
        ) {
          if (profile.has(event.name) === false) {
            profile.set(event.name, new Map());
            profileConstantLRU.set(event.name, new Set());
          }

          // profile "readContract" and "multicall" actions
          if (action === "readContract") {
            const recordPatternResult = recordProfilePattern({
              event: event,
              args: args as Omit<
                Parameters<PonderActions["readContract"]>[0],
                "blockNumber" | "cache"
              >,
              hints: Array.from(profile.get(event.name)!.values()),
            });
            if (recordPatternResult) {
              addProfilePattern(recordPatternResult);
            }
          } else if (action === "multicall") {
            const contracts = (
              args as Omit<
                Parameters<PonderActions["multicall"]>[0],
                "blockNumber" | "cache"
              >
            ).contracts as ContractFunctionParameters[];

            if (contracts.length < 10) {
              for (const contract of contracts) {
                const recordPatternResult = recordProfilePattern({
                  event: event,
                  args: contract,
                  hints: Array.from(profile.get(event.name)!.values()),
                });
                if (recordPatternResult) {
                  addProfilePattern(recordPatternResult);
                }
              }
            }
          }
        }

        const blockNumber =
          event.type === "setup" ? event.block : event.event.block.number;

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
    ] as const) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    const actionsWithMetrics = {} as PonderActions;

    for (const [action, actionFn] of Object.entries(actions)) {
      // @ts-ignore
      actionsWithMetrics[action] = async (
        ...args: Parameters<PonderActions[keyof PonderActions]>
      ) => {
        const endClock = startClock();
        try {
          // @ts-ignore
          return await actionFn(...args);
        } finally {
          common.metrics.ponder_indexing_rpc_action_duration.observe(
            { action },
            endClock(),
          );
        }
      };
    }

    return actionsWithMetrics;
  };

  return {
    getClient(chain) {
      const rpc =
        indexingBuild.rpcs[indexingBuild.chains.findIndex((n) => n === chain)]!;

      return createClient({
        transport: cachedTransport({
          common,
          chain,
          rpc,
          syncStore,
          cache,
        }),
        chain: chain.viemChain,
        // @ts-expect-error overriding `readContract` is not supported by viem
      }).extend(ponderActions);
    },
    async prefetch({ events }) {
      // Use profiling metadata + next event batch to determine which
      // rpc requests are going to be made, and preload them into the cache.

      const prediction: { ev: number; request: Request }[] = [];

      for (const event of events) {
        if (profile.has(event.name)) {
          for (const [, { pattern, count }] of profile.get(event.name)!) {
            // Expected value of times the prediction will be used.
            const ev = (count * SAMPLING_RATE) / eventCount[event.name]!;
            prediction.push({
              ev,
              request: recoverProfilePattern(pattern, event),
            });
          }
        }
      }

      const chainRequests: Map<
        number,
        { ev: number; request: EIP1193Parameters }[]
      > = new Map();
      for (const chain of indexingBuild.chains) {
        chainRequests.set(chain.id, []);
      }

      for (const { ev, request } of dedupe(prediction, ({ request }) =>
        getCacheKey(encodeRequest(request)),
      )) {
        chainRequests.get(request.chainId)!.push({
          ev,
          request: encodeRequest(request),
        });
      }

      await Promise.all(
        Array.from(chainRequests.entries()).map(async ([chainId, requests]) => {
          const i = indexingBuild.chains.findIndex((n) => n.id === chainId);
          const chain = indexingBuild.chains[i]!;
          const rpc = indexingBuild.rpcs[i]!;

          const dbRequests = requests.filter(
            ({ ev }) => ev > DB_PREDICTION_THRESHOLD,
          );

          common.metrics.ponder_indexing_rpc_prefetch_total.inc(
            {
              chain: chain.name,
              method: "eth_call",
              type: "database",
            },
            dbRequests.length,
          );

          const cachedResults = await syncStore.getRpcRequestResults({
            requests: dbRequests.map(({ request }) => request),
            chainId,
          });

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const cachedResult = cachedResults[i]!;

            if (cachedResult !== undefined) {
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), cachedResult);
            } else if (request.ev > RPC_PREDICTION_THRESHOLD) {
              const resultPromise = rpc
                .request(request.request as EIP1193Parameters<PublicRpcSchema>)
                .then((result) => JSON.stringify(result))
                .catch((error) => error as Error);

              common.metrics.ponder_indexing_rpc_prefetch_total.inc({
                chain: chain.name,
                method: "eth_call",
                type: "rpc",
              });

              // Note: Unawaited request added to cache
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), resultPromise);
            }
          }

          if (dbRequests.length > 0) {
            common.logger.debug({
              service: "rpc",
              msg: `Pre-fetched ${dbRequests.length} ${chain.name} RPC requests`,
            });
          }
        }),
      );
    },
    clear() {
      for (const chain of indexingBuild.chains) {
        cache.get(chain.id)!.clear();
      }
    },
    set event(_event: Event | SetupEvent) {
      event = _event;
    },
  };
};

export const cachedTransport =
  ({
    common,
    chain,
    rpc,
    syncStore,
    cache,
  }: {
    common: Common;
    chain: Chain;
    rpc: Rpc;
    syncStore: SyncStore;
    cache: Cache;
  }): Transport =>
  ({ chain: viemChain }) =>
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

          const multicallRequests = decodeFunctionData({
            abi: multicall3Abi,
            data: params[0]!.data,
          }).args[0];

          if (multicallRequests.length === 0) {
            // empty multicall result
            return "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
          }

          const requests = multicallRequests.map(
            (call) =>
              ({
                method: "eth_call",
                params: [
                  {
                    to: call.target,
                    data: call.callData,
                  },
                  blockNumber,
                ],
              }) as const satisfies EIP1193Parameters,
          );
          const results = new Map<
            EIP1193Parameters,
            {
              success: boolean;
              returnData: `0x${string}`;
            }
          >();
          const requestsToInsert = new Set<EIP1193Parameters>();

          for (const request of requests) {
            const cacheKey = getCacheKey(request);

            if (cache.get(chain.id)!.has(cacheKey)) {
              const cachedResult = cache.get(chain.id)!.get(cacheKey)!;

              if (cachedResult instanceof Promise) {
                common.metrics.ponder_indexing_rpc_requests_total.inc({
                  chain: chain.name,
                  method,
                  type: "prefetch_rpc",
                });
                const result = await cachedResult;

                // Note: we don't attempt to cache or prefetch errors, instead relying on the eventual RPC request.

                if (result instanceof Error) continue;

                if (result !== "0x") {
                  requestsToInsert.add(request);
                }

                results.set(request, {
                  success: true,
                  returnData: decodeResponse(result),
                });
              } else {
                common.metrics.ponder_indexing_rpc_requests_total.inc({
                  chain: chain.name,
                  method,
                  type: "prefetch_database",
                });
                results.set(request, {
                  success: true,
                  returnData: decodeResponse(cachedResult),
                });
              }
            }
          }

          const dbRequests = requests.filter(
            (request) => results.has(request) === false,
          );

          const dbResults = await syncStore.getRpcRequestResults({
            requests: dbRequests,
            chainId: chain.id,
          });

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const result = dbResults[i]!;

            if (result !== undefined) {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "database",
              });

              results.set(request, {
                success: true,
                returnData: decodeResponse(result),
              });
            }
          }

          if (results.size < requests.length) {
            const _requests = requests.filter(
              (request) => results.has(request) === false,
            );

            const multicallResult = await rpc
              .request({
                method: "eth_call",
                params: [
                  {
                    to: params[0]!.to,
                    data: encodeFunctionData({
                      abi: multicall3Abi,
                      functionName: "aggregate3",
                      args: [
                        multicallRequests.filter(
                          (_, i) => results.has(requests[i]!) === false,
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

            for (let i = 0; i < _requests.length; i++) {
              const request = _requests[i]!;
              const result = multicallResult[i]!;

              if (result.success && result.returnData !== "0x") {
                requestsToInsert.add(request);
              }

              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "rpc",
              });

              results.set(request, result);
            }
          }

          const encodedBlockNumber =
            blockNumber === undefined
              ? undefined
              : blockNumber === "latest"
                ? 0
                : hexToNumber(blockNumber);

          // Note: insertRpcRequestResults errors can be ignored and not awaited, since
          // the response is already fetched.
          syncStore
            .insertRpcRequestResults({
              requests: Array.from(requestsToInsert).map((request) => ({
                request,
                blockNumber: encodedBlockNumber,
                result: JSON.stringify(results.get(request)!.returnData),
              })),
              chainId: chain.id,
            })
            .catch(() => {});

          // Note: at this point, it is an invariant that either `allowFailure` is true or
          // there are no failed requests.

          // Note: viem <= 2.23.6 had a bug with `encodeFunctionResult` which can be worked around by adding
          // another layer of array nesting.
          // Fixed by this commit https://github.com/wevm/viem/commit/9c442de0ff38ac1f654b5c751d292e9a9f8d574c

          const resultsToEncode = requests.map(
            (request) => results.get(request)!,
          );

          try {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              result: resultsToEncode,
            });
          } catch (e) {
            return encodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              result: [
                // @ts-expect-error known issue in viem <= 2.23.6
                resultsToEncode,
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
            case "debug_traceBlockByNumber":
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

          const encodedBlockNumber =
            blockNumber === undefined
              ? undefined
              : blockNumber === "latest"
                ? 0
                : hexToNumber(blockNumber);

          const cacheKey = getCacheKey(body);

          if (cache.get(chain.id)!.has(cacheKey)) {
            const cachedResult = cache.get(chain.id)!.get(cacheKey)!;

            // `cachedResult` is a Promise if the request had to be fetched from the RPC.
            if (cachedResult instanceof Promise) {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_rpc",
              });
              const result = await cachedResult;

              if (result instanceof Error) throw result;

              // Note: "0x" is a valid response for some requests, but is sometimes erroneously returned by the RPC.
              // Because the frequency of these valid requests with no return data is very low, we don't cache it.
              if (result !== "0x") {
                // Note: insertRpcRequestResults errors can be ignored and not awaited, since
                // the response is already fetched.
                syncStore
                  .insertRpcRequestResults({
                    requests: [
                      {
                        request: body,
                        blockNumber: encodedBlockNumber,
                        result,
                      },
                    ],
                    chainId: chain.id,
                  })
                  .catch(() => {});
              }

              return decodeResponse(result);
            } else {
              common.metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_database",
              });
            }

            return decodeResponse(cachedResult);
          }

          const [cachedResult] = await syncStore.getRpcRequestResults({
            requests: [body],
            chainId: chain.id,
          });

          if (cachedResult !== undefined) {
            common.metrics.ponder_indexing_rpc_requests_total.inc({
              chain: chain.name,
              method,
              type: "database",
            });

            return decodeResponse(cachedResult);
          }

          common.metrics.ponder_indexing_rpc_requests_total.inc({
            chain: chain.name,
            method,
            type: "rpc",
          });

          const response = await rpc.request(body);

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
                    blockNumber: encodedBlockNumber,
                    result: JSON.stringify(response),
                  },
                ],
                chainId: chain.id,
              })
              .catch(() => {});
          }
          return response;
        } else {
          return rpc.request(body);
        }
      },
    })({ chain: viemChain, retryCount: 0 });
