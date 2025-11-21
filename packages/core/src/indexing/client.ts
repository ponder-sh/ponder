import type { Common } from "@/internal/common.js";
import type { Chain, IndexingBuild, SetupEvent } from "@/internal/types.js";
import type { Event } from "@/internal/types.js";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  type Abi,
  type Account,
  BlockNotFoundError,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionParameters,
  type GetBlockReturnType,
  type GetTransactionConfirmationsParameters,
  type GetTransactionConfirmationsReturnType,
  type GetTransactionParameters,
  type GetTransactionReceiptParameters,
  type GetTransactionReceiptReturnType,
  type GetTransactionReturnType,
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
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
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

/**
 * RPC responses that are not cached. These are valid responses
 * that are sometimes erroneously returned by the RPC.
 *
 * `"0x"` is returned by `eth_call` and causes the `ContractFunctionZeroDataError`.
 * `null` is returned by `eth_getBlockByNumber` and `eth_getBlockByHash` and causes the `BlockNotFoundError`.
 */
const UNCACHED_RESPONSES = ["0x", null] as any[];

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
  "readContract",
  "multicall",
  "simulateContract",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions where the `block` property is required. */
const blockRequiredActions = [
  "getBlock",
  "getTransactionCount",
  "getBlockTransactionCount",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions where the `block` property is non-existent. */
const nonBlockDependentActions = [
  "getTransaction",
  "getTransactionReceipt",
  "getTransactionConfirmations",
] as const satisfies readonly (keyof ReturnType<typeof publicActions>)[];

/** Viem actions that should be retried if they fail. */
const retryableActions = [
  "readContract",
  "simulateContract",
  "multicall",
  "getBlock",
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

type RetryableOptions = {
  /**
   * Whether or not to retry the action if the response is empty.
   *
   * @default true
   */
  retryEmptyResponse?: boolean;
};

type BlockDependentAction<
  fn extends (client: any, args: any) => unknown,
  ///
  params = Parameters<fn>[0],
  returnType = ReturnType<fn>,
> = (
  args: Omit<params, "blockTag" | "blockNumber"> & BlockOptions,
) => returnType;

export type PonderActions = Omit<
  {
    [action in (typeof blockDependentActions)[number]]: BlockDependentAction<
      ReturnType<typeof publicActions>[action]
    >;
  } & Pick<PublicActions, (typeof nonBlockDependentActions)[number]> &
    Pick<PublicActions, (typeof blockRequiredActions)[number]>,
  (typeof retryableActions)[number]
> & {
  // Types for `retryableActions` are manually defined.
  readContract: <
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "pure" | "view">,
    const args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  >(
    args: Omit<
      ReadContractParameters<abi, functionName, args>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions &
      RetryableOptions,
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
      BlockOptions &
      RetryableOptions,
  ) => Promise<SimulateContractReturnType<abi, functionName, args>>;
  multicall: <
    const contracts extends readonly unknown[],
    allowFailure extends boolean = true,
  >(
    args: Omit<
      MulticallParameters<contracts, allowFailure>,
      "blockTag" | "blockNumber"
    > &
      BlockOptions &
      RetryableOptions,
  ) => Promise<MulticallReturnType<contracts, allowFailure>>;
  getBlock: <includeTransactions extends boolean = false>(
    args: {
      /** Whether or not to include transaction data in the response. */
      includeTransactions?: includeTransactions | undefined;
    } & RequiredBlockOptions &
      RetryableOptions,
  ) => Promise<GetBlockReturnType<ViemChain | undefined, includeTransactions>>;
  getTransaction: (
    args: GetTransactionParameters & RetryableOptions,
  ) => Promise<GetTransactionReturnType>;
  getTransactionReceipt: (
    args: GetTransactionReceiptParameters & RetryableOptions,
  ) => Promise<GetTransactionReceiptReturnType>;
  getTransactionConfirmations: (
    args: GetTransactionConfirmationsParameters & RetryableOptions,
  ) => Promise<GetTransactionConfirmationsReturnType>;
};

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
> & { blockNumber: bigint | "latest"; chainId: number };
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
  cache?: "immutable";
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

export const getCacheKey = (request: RequestParameters) => {
  return toLowerCase(JSON.stringify(orderObject(request)));
};

export const encodeRequest = (request: Request) =>
  ({
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
      request.blockNumber === "latest" ? "latest" : toHex(request.blockNumber),
    ],
  }) satisfies RequestParameters;

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
      const eventName = (event as Event).eventCallback.name;

      if (profile.get(eventName)!.has(profilePatternKey)) {
        profile.get(eventName)!.get(profilePatternKey)!.count++;

        if (hasConstant) {
          profileConstantLRU.get(eventName)!.delete(profilePatternKey);
          profileConstantLRU.get(eventName)!.add(profilePatternKey);
        }
      } else {
        profile
          .get(eventName)!
          .set(profilePatternKey, { pattern, hasConstant, count: 1 });

        if (hasConstant) {
          profileConstantLRU.get(eventName)!.add(profilePatternKey);
          if (
            profileConstantLRU.get(eventName)!.size > MAX_CONSTANT_PATTERN_COUNT
          ) {
            const firstKey = profileConstantLRU
              .get(eventName)!
              .keys()
              .next().value;
            if (firstKey) {
              profile.get(eventName)!.delete(firstKey);
              profileConstantLRU.get(eventName)!.delete(firstKey);
            }
          }
        }
      }
    };

    const getPonderAction = <
      action extends (typeof blockDependentActions)[number],
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
          eventCount[event.eventCallback.name]! % SAMPLING_RATE === 1
        ) {
          const eventName = event.eventCallback.name;

          if (profile.has(eventName) === false) {
            profile.set(eventName, new Map());
            profileConstantLRU.set(eventName, new Set());
          }

          // profile "readContract" and "multicall" actions
          if (action === "readContract") {
            const recordPatternResult = recordProfilePattern({
              event: event,
              args: { ...args, cache } as Parameters<
                PonderActions["readContract"]
              >[0],
              hints: Array.from(profile.get(eventName)!.values()),
            });
            if (recordPatternResult) {
              addProfilePattern(recordPatternResult);
            }
          } else if (action === "multicall") {
            const contracts = (
              { ...args, cache } as Parameters<PonderActions["multicall"]>[0]
            ).contracts as ContractFunctionParameters[];

            if (contracts.length < 10) {
              for (const contract of contracts) {
                const recordPatternResult = recordProfilePattern({
                  event: event,
                  args: contract,
                  hints: Array.from(profile.get(eventName)!.values()),
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

    const getRetryAction = (
      action: PonderActions[keyof PonderActions],
      actionName: keyof PonderActions,
    ) => {
      return async (...args: Parameters<typeof action>) => {
        const RETRY_COUNT = 9;
        const BASE_DURATION = 125;
        for (let i = 0; i <= RETRY_COUNT; i++) {
          try {
            // @ts-ignore
            return await action(...args);
          } catch (error) {
            const eventName =
              event.type === "setup"
                ? event.setupCallback.name
                : event.eventCallback.name;
            if (
              (error instanceof BlockNotFoundError === false &&
                error instanceof TransactionNotFoundError === false &&
                error instanceof TransactionReceiptNotFoundError === false &&
                // Note: Another way to catch this error is:
                // `error instanceof ContractFunctionExecutionError && error.cause instanceOf ContractFunctionZeroDataError`
                (error as Error)?.message?.includes("returned no data") ===
                  false) ||
              i === RETRY_COUNT ||
              (args[0] as RetryableOptions).retryEmptyResponse === false
            ) {
              const chain = indexingBuild.chains.find(
                (n) => n.id === event.chain.id,
              )!;
              common.logger.warn({
                msg: "Failed 'context.client' action",
                action: actionName,
                event: eventName,
                chain: chain.name,
                chain_id: chain.id,
                retry_count: i,
                error: error as Error,
              });

              throw error;
            }

            const duration = BASE_DURATION * 2 ** i;
            const chain = indexingBuild.chains.find(
              (n) => n.id === event.chain.id,
            )!;
            common.logger.warn({
              msg: "Failed 'context.client' action",
              action: actionName,
              event: eventName,
              chain: chain.name,
              chain_id: chain.id,
              retry_count: i,
              retry_delay: duration,
              error: error as Error,
            });
            await wait(duration);
          }
        }
      };
    };

    for (const action of blockDependentActions) {
      actions[action] = getPonderAction(action);
    }

    for (const action of nonBlockDependentActions) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    for (const action of blockRequiredActions) {
      // @ts-ignore
      actions[action] = _publicActions[action];
    }

    for (const action of retryableActions) {
      // @ts-ignore
      actions[action] = getRetryAction(actions[action], action);
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
          event: () => event,
        }),
        chain: chain.viemChain,
        // @ts-expect-error overriding `readContract` is not supported by viem
      }).extend(ponderActions);
    },
    async prefetch({ events }) {
      const context = {
        logger: common.logger.child({ action: "prefetch_rpc_requests" }),
      };
      const prefetchEndClock = startClock();

      // Use profiling metadata + next event batch to determine which
      // rpc requests are going to be made, and preload them into the cache.

      const prediction: { ev: number; request: Request }[] = [];

      for (const event of events) {
        if (profile.has(event.eventCallback.name)) {
          for (const [, { pattern, count }] of profile.get(
            event.eventCallback.name,
          )!) {
            // Expected value of times the prediction will be used.
            const ev =
              (count * SAMPLING_RATE) / eventCount[event.eventCallback.name]!;
            prediction.push({
              ev,
              request: recoverProfilePattern(pattern, event),
            });
          }
        }
      }

      const chainRequests: Map<
        number,
        { ev: number; request: RequestParameters }[]
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

          const cachedResults = await syncStore.getRpcRequestResults(
            {
              requests: dbRequests.map(({ request }) => request),
              chainId,
            },
            context,
          );

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const cachedResult = cachedResults[i]!;

            if (cachedResult !== undefined) {
              cache
                .get(chainId)!
                .set(getCacheKey(request.request), cachedResult);
            } else if (request.ev > RPC_PREDICTION_THRESHOLD) {
              const resultPromise = rpc
                .request(request.request, context)
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
              msg: "Prefetched JSON-RPC requests",
              chain: chain.name,
              chain_id: chain.id,
              request_count: dbRequests.length,
              duration: prefetchEndClock(),
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
    event,
  }: {
    common: Common;
    chain: Chain;
    rpc: Rpc;
    syncStore: SyncStore;
    cache: Cache;
    event: () => Event | SetupEvent;
  }): Transport =>
  ({ chain: viemChain }) =>
    custom({
      async request({ method, params }) {
        const _event = event();
        const context = {
          logger: common.logger.child({
            action: "cache JSON-RPC request",
            event:
              _event.type === "setup"
                ? _event.setupCallback.name
                : _event.eventCallback.name,
          }),
        };
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
                  blockNumber ?? "latest",
                ],
              }) as const satisfies RequestParameters,
          );
          const results = new Map<
            RequestParameters,
            {
              success: boolean;
              returnData: `0x${string}`;
            }
          >();
          const requestsToInsert = new Set<RequestParameters>();

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

                if (UNCACHED_RESPONSES.includes(result) === false) {
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

          const dbResults = await syncStore.getRpcRequestResults(
            { requests: dbRequests, chainId: chain.id },
            context,
          );

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
              .request(
                {
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
                },
                context,
              )
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

              if (
                result.success &&
                UNCACHED_RESPONSES.includes(result.returnData) === false
              ) {
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
            .insertRpcRequestResults(
              {
                requests: Array.from(requestsToInsert).map((request) => ({
                  request,
                  blockNumber: encodedBlockNumber,
                  result: JSON.stringify(results.get(request)!.returnData),
                })),
                chainId: chain.id,
              },
              context,
            )
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
          const blockNumber = extractBlockNumberParam(body);
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

              if (UNCACHED_RESPONSES.includes(result) === false) {
                // Note: insertRpcRequestResults errors can be ignored and not awaited, since
                // the response is already fetched.
                syncStore
                  .insertRpcRequestResults(
                    {
                      requests: [
                        {
                          request: body,
                          blockNumber: encodedBlockNumber,
                          result,
                        },
                      ],
                      chainId: chain.id,
                    },
                    context,
                  )
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

          const [cachedResult] = await syncStore.getRpcRequestResults(
            { requests: [body], chainId: chain.id },
            context,
          );

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

          const response = await rpc.request(body, context);

          if (UNCACHED_RESPONSES.includes(response) === false) {
            // Note: insertRpcRequestResults errors can be ignored and not awaited, since
            // the response is already fetched.
            syncStore
              .insertRpcRequestResults(
                {
                  requests: [
                    {
                      request: body,
                      blockNumber: encodedBlockNumber,
                      result: JSON.stringify(response),
                    },
                  ],
                  chainId: chain.id,
                },
                context,
              )
              .catch(() => {});
          }
          return response;
        } else {
          return rpc.request(body, context);
        }
      },
    })({ chain: viemChain, retryCount: 0 });

export const extractBlockNumberParam = (request: RequestParameters) => {
  let blockNumber: Hex | "latest" | undefined = undefined;

  switch (request.method) {
    case "eth_getBlockByNumber":
    case "eth_getBlockTransactionCountByNumber":
    case "eth_getTransactionByBlockNumberAndIndex":
    case "eth_getUncleByBlockNumberAndIndex":
    case "debug_traceBlockByNumber":
      // @ts-expect-error
      [blockNumber] = request.params;
      break;
    case "eth_getBalance":
    case "eth_call":
    case "eth_getCode":
    case "eth_estimateGas":
    case "eth_feeHistory":
    case "eth_getTransactionCount":
      // @ts-expect-error
      [, blockNumber] = request.params;
      break;

    case "eth_getProof":
    case "eth_getStorageAt":
      // @ts-expect-error
      [, , blockNumber] = request.params;
      break;
  }

  return blockNumber;
};
