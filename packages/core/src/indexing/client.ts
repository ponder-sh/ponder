import { Effect, Exit, Fiber, FiberSet, Result, type Scope } from "effect";
import {
  type Abi,
  type Account,
  BlockNotFoundError,
  type Client,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionParameters,
  createClient,
  custom,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  type GetBlockReturnType,
  type GetTransactionConfirmationsParameters,
  type GetTransactionConfirmationsReturnType,
  type GetTransactionParameters,
  type GetTransactionReceiptParameters,
  type GetTransactionReceiptReturnType,
  type GetTransactionReturnType,
  getAbiItem,
  type Hash,
  type Hex,
  hexToNumber,
  type MulticallParameters,
  type MulticallReturnType,
  multicall3Abi,
  type Prettify,
  type PublicActions,
  type PublicRpcSchema,
  publicActions,
  type ReadContractParameters,
  type ReadContractReturnType,
  type SimulateContractParameters,
  type SimulateContractReturnType,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Transport,
  toFunctionSelector,
  toHex,
  type Chain as ViemChain,
} from "viem";
import { Metrics } from "@/internal/metrics.js";
import type {
  Chain,
  Event,
  IndexingBuild,
  SetupEvent,
} from "@/internal/types.js";
import type { RequestParameters, Rpc } from "@/rpc/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClockEffect } from "@/utils/timer.js";
import {
  getProfilePatternKey,
  recordProfilePattern,
  recoverProfilePattern,
} from "./profile.js";

export type CachedViemClient = {
  getClient: (chain: Chain) => ReadonlyClient;
  /**
   * Predict and load the RPC requests of the next event batch, from the rpc
   * cache or the RPC.
   */
  prefetch: (params: { events: Event[] }) => Effect.Effect<void, Error>;
  clear: () => void;
  event: Event | SetupEvent | undefined;
  /**
   * Write the rpc cache results of the requests of the events of `chainId` at
   * or before `checkpoint`, which is finalized. The results of later events
   * are written once they are finalized.
   *
   * Note: Until the first call for a chain, the results are written at once.
   */
  finalize: (params: {
    chainId: number;
    checkpoint: string;
  }) => Effect.Effect<void>;
  /**
   * Discard the rpc cache results of the requests of the events of `chainId`
   * after `checkpoint`, which are reorged.
   */
  reorg: (params: { chainId: number; checkpoint: string }) => void;
};

const MULTICALL_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: multicall3Abi, name: "aggregate3" }),
);

const SAMPLING_RATE = 10;
const DB_PREDICTION_THRESHOLD = 0.2;
const RPC_PREDICTION_THRESHOLD = 0.8;
const MAX_CONSTANT_PATTERN_COUNT = 10;
const RETRY_COUNT = 9;
const BASE_DURATION = 125;

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
/**
 * Results of requests per chain. A request that is prefetched from the RPC is
 * a fiber until an indexing function makes it.
 */
type Cache = Map<
  number,
  Map<CacheKey, Fiber.Fiber<Response, Error> | Response>
>;

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
  } catch (_error) {
    return response;
  }
};

/**
 * Create the `context.client` of each chain, which caches RPC requests in
 * memory and in the rpc cache.
 *
 * @dev The clients return promises for indexing functions. Requests run as
 * fibers that are interrupted when the scope closes.
 */
export const createCachedViemClient = ({
  indexingBuild,
  syncStore,
  eventCount,
}: {
  indexingBuild: Pick<IndexingBuild, "chains" | "rpcs">;
  syncStore: SyncStore;
  eventCount: { [eventName: string]: number };
}): Effect.Effect<CachedViemClient, never, Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    /** Requests of indexing functions, prefetched requests, and rpc cache writes. */
    const fibers = yield* FiberSet.make<unknown, unknown>();
    const runPromise = yield* FiberSet.runtimePromise(fibers)();

    let event: Event | SetupEvent = undefined!;
    const cache: Cache = new Map();
    const profile: Profile = new Map();
    const profileConstantLRU: ProfileConstantLRU = new Map();

    for (const chain of indexingBuild.chains) {
      cache.set(chain.id, new Map());
    }

    const getEventName = () =>
      event.type === "setup"
        ? event.setupCallback.name
        : event.eventCallback.name;

    /**
     * Write the results of requests to the rpc cache in the background.
     *
     * Note: Failed writes are ignored, since the responses are already fetched.
     */
    const writeRpcRequestResults = (
      ...args: Parameters<SyncStore["insertRpcRequestResults"]>
    ) =>
      FiberSet.run(
        fibers,
        syncStore.insertRpcRequestResults(...args).pipe(Effect.ignore),
      );

    /** The finalized checkpoint of each chain, see `finalize`. */
    const finalizedCheckpoints = new Map<number, string>();
    /**
     * The rpc cache results of the requests of unfinalized events of each
     * chain, by cache key, with the checkpoint of the first event.
     */
    const unfinalizedResults = new Map<
      number,
      Map<
        string,
        Parameters<
          SyncStore["insertRpcRequestResults"]
        >[0]["requests"][number] & { checkpoint: string }
      >
    >();
    for (const chain of indexingBuild.chains) {
      unfinalizedResults.set(chain.id, new Map());
    }

    // Note: The rpc cache is keyed by block number, so a cached result of a
    // block that is reorged, such as while the app is down, would be read for
    // the block that replaces it. Only the results of finalized events are
    // written, and of requests at the "latest" block (encoded as 0), which are
    // immutable.
    const insertRpcRequestResults = (
      ...[{ requests, chainId }, context]: Parameters<
        SyncStore["insertRpcRequestResults"]
      >
    ) => {
      const finalizedCheckpoint = finalizedCheckpoints.get(chainId);
      if (
        finalizedCheckpoint === undefined ||
        event.checkpoint <= finalizedCheckpoint
      ) {
        return writeRpcRequestResults({ requests, chainId }, context);
      }

      const results = unfinalizedResults.get(chainId)!;
      for (const request of requests) {
        const cacheKey = getCacheKey(request.request);
        if (request.blockNumber !== 0 && results.has(cacheKey) === false) {
          results.set(cacheKey, { ...request, checkpoint: event.checkpoint });
        }
      }

      const immutableRequests = requests.filter(
        ({ blockNumber }) => blockNumber === 0,
      );
      return immutableRequests.length === 0
        ? Effect.void
        : writeRpcRequestResults(
            { requests: immutableRequests, chainId },
            context,
          );
    };

    /** Read the rpc cache, and the results of unfinalized events. */
    const getRpcRequestResults = (
      ...[{ requests, chainId }, context]: Parameters<
        SyncStore["getRpcRequestResults"]
      >
    ) =>
      Effect.gen(function* () {
        const results = unfinalizedResults.get(chainId)!;
        const dbResults = yield* syncStore.getRpcRequestResults(
          {
            requests: requests.filter(
              (request) => results.has(getCacheKey(request)) === false,
            ),
            chainId,
          },
          context,
        );
        let index = 0;
        return requests.map(
          (request) =>
            results.get(getCacheKey(request))?.result ?? dbResults[index++],
        );
      });

    /** Send `body` with the cache in memory, the rpc cache, then the RPC. */
    const request = (
      chain: Chain,
      rpc: Rpc,
      { method, params }: { method: string; params: any },
    ): Effect.Effect<unknown, Error> =>
      Effect.gen(function* () {
        const context = {
          logAnnotations: {
            action: "cache JSON-RPC request",
            event: getEventName(),
          },
        };
        const body = { method, params } as RequestParameters;

        // multicall
        if (
          method === "eth_call" &&
          params[0]?.data?.startsWith(MULTICALL_SELECTOR)
        ) {
          let blockNumber: Hex | "latest" | undefined;
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

              if (Fiber.isFiber(cachedResult)) {
                metrics.ponder_indexing_rpc_requests_total.inc({
                  chain: chain.name,
                  method,
                  type: "prefetch_rpc",
                });
                const result = yield* Fiber.await(cachedResult);

                // Note: we don't attempt to cache or prefetch errors, instead relying on the eventual RPC request.

                if (Exit.isFailure(result)) continue;

                if (UNCACHED_RESPONSES.includes(result.value) === false) {
                  requestsToInsert.add(request);
                }

                results.set(request, {
                  success: true,
                  returnData: decodeResponse(result.value),
                });
              } else {
                metrics.ponder_indexing_rpc_requests_total.inc({
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

          const dbResults = chain.cacheRpcRequests
            ? yield* getRpcRequestResults(
                { requests: dbRequests, chainId: chain.id },
                context,
              )
            : [];

          for (let i = 0; i < dbRequests.length; i++) {
            const request = dbRequests[i]!;
            const result = dbResults[i];

            if (result !== undefined) {
              metrics.ponder_indexing_rpc_requests_total.inc({
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

            const multicallResult = decodeFunctionResult({
              abi: multicall3Abi,
              functionName: "aggregate3",
              data: yield* rpc.request(
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
              ),
            });

            for (let i = 0; i < _requests.length; i++) {
              const request = _requests[i]!;
              const result = multicallResult[i]!;

              if (
                result.success &&
                UNCACHED_RESPONSES.includes(result.returnData) === false
              ) {
                requestsToInsert.add(request);
              }

              metrics.ponder_indexing_rpc_requests_total.inc({
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

          if (chain.cacheRpcRequests) {
            yield* insertRpcRequestResults(
              {
                requests: Array.from(requestsToInsert).map((request) => ({
                  request,
                  blockNumber: encodedBlockNumber,
                  result: JSON.stringify(results.get(request)!.returnData),
                })),
                chainId: chain.id,
              },
              context,
            );
          }

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
          } catch (_e) {
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

            // `cachedResult` is a fiber if the request had to be fetched from the RPC.
            if (Fiber.isFiber(cachedResult)) {
              metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_rpc",
              });
              const result = yield* Fiber.join(cachedResult);

              if (
                chain.cacheRpcRequests &&
                UNCACHED_RESPONSES.includes(result) === false
              ) {
                yield* insertRpcRequestResults(
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
                );
              }

              return decodeResponse(result);
            } else {
              metrics.ponder_indexing_rpc_requests_total.inc({
                chain: chain.name,
                method,
                type: "prefetch_database",
              });
            }

            return decodeResponse(cachedResult);
          }

          const [cachedResult] = chain.cacheRpcRequests
            ? yield* getRpcRequestResults(
                { requests: [body], chainId: chain.id },
                context,
              )
            : [undefined];

          if (cachedResult !== undefined) {
            metrics.ponder_indexing_rpc_requests_total.inc({
              chain: chain.name,
              method,
              type: "database",
            });

            return decodeResponse(cachedResult);
          }

          metrics.ponder_indexing_rpc_requests_total.inc({
            chain: chain.name,
            method,
            type: "rpc",
          });

          const response = yield* rpc.request(body, context);

          if (
            chain.cacheRpcRequests &&
            UNCACHED_RESPONSES.includes(response) === false
          ) {
            yield* insertRpcRequestResults(
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
            );
          }
          return response;
        } else {
          return yield* rpc.request(body, context);
        }
      });

    const ponderActions = <
      TTransport extends Transport = Transport,
      TChain extends ViemChain | undefined = ViemChain | undefined,
      TAccount extends Account | undefined = Account | undefined,
    >(
      client: Client<TTransport, TChain, TAccount>,
    ): PonderActions => {
      const _publicActions = publicActions(client);

      const addProfilePattern = ({
        pattern,
        hasConstant,
      }: {
        pattern: ProfilePattern;
        hasConstant: boolean;
      }) => {
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
              profileConstantLRU.get(eventName)!.size >
              MAX_CONSTANT_PATTERN_COUNT
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

      /** Retry `action` when the RPC returns an empty response. */
      const withRetry =
        (
          action: (...args: any[]) => Effect.Effect<unknown, Error>,
          actionName: keyof PonderActions,
        ) =>
        (...args: any[]): Effect.Effect<unknown, Error> =>
          Effect.gen(function* () {
            for (let i = 0; i <= RETRY_COUNT; i++) {
              const result = yield* Effect.result(action(...args));
              if (Result.isSuccess(result)) return result.success;

              const error = result.failure;
              const chain = indexingBuild.chains.find(
                (n) => n.id === event.chain.id,
              )!;

              if (
                (error instanceof BlockNotFoundError === false &&
                  error instanceof TransactionNotFoundError === false &&
                  error instanceof TransactionReceiptNotFoundError === false &&
                  // Note: Another way to catch this error is:
                  // `error instanceof ContractFunctionExecutionError && error.cause instanceOf ContractFunctionZeroDataError`
                  error?.message?.includes("returned no data") === false) ||
                i === RETRY_COUNT ||
                (args[0] as RetryableOptions).retryEmptyResponse === false
              ) {
                yield* Effect.logWarning({
                  msg: "Failed 'context.client' action",
                  action: actionName,
                  event: getEventName(),
                  chain: chain.name,
                  chain_id: chain.id,
                  retry_count: i,
                  error,
                });

                return yield* Effect.fail(error);
              }

              const duration = BASE_DURATION * 2 ** i;
              yield* Effect.logWarning({
                msg: "Failed 'context.client' action",
                action: actionName,
                event: getEventName(),
                chain: chain.name,
                chain_id: chain.id,
                retry_count: i,
                retry_delay: duration,
                error,
              });
              yield* Effect.sleep(duration);
            }

            return yield* Effect.die("unreachable");
          });

      const actions = {} as Record<
        keyof PonderActions,
        (...args: any[]) => Effect.Effect<unknown, Error>
      >;

      for (const action of blockDependentActions) {
        const ponderAction = getPonderAction(action);
        actions[action] = (...args) =>
          fromPromise(() => (ponderAction as any)(...args));
      }

      for (const action of [
        ...nonBlockDependentActions,
        ...blockRequiredActions,
      ]) {
        actions[action] = (...args) =>
          fromPromise(() => (_publicActions[action] as any)(...args));
      }

      for (const action of retryableActions) {
        actions[action] = withRetry(actions[action], action);
      }

      const actionsWithMetrics = {} as PonderActions;

      for (const [action, actionFn] of Object.entries(actions)) {
        // @ts-expect-error
        actionsWithMetrics[action] = (...args: any[]) =>
          runPromise(
            Effect.gen(function* () {
              const endClock = yield* startClockEffect;
              return yield* actionFn(...args).pipe(
                Effect.ensuring(
                  Effect.map(endClock, (duration) =>
                    metrics.ponder_indexing_rpc_action_duration.observe(
                      { action },
                      duration,
                    ),
                  ),
                ),
              );
            }),
          );
      }

      return actionsWithMetrics;
    };

    const cachedViemClient: CachedViemClient = {
      getClient(chain) {
        const rpc = indexingBuild.rpcs[indexingBuild.chains.indexOf(chain)]!;

        return createClient({
          transport: ({ chain: viemChain }) =>
            custom({
              request: (body) => runPromise(request(chain, rpc, body)),
            })({ chain: viemChain, retryCount: 0 }),
          chain: chain.viemChain,
          // @ts-expect-error overriding `readContract` is not supported by viem
        }).extend(ponderActions);
      },
      prefetch: ({ events }) =>
        Effect.gen(function* () {
          const context = {
            logAnnotations: { action: "prefetch_rpc_requests" },
          };
          const prefetchEndClock = yield* startClockEffect;

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
                  (count * SAMPLING_RATE) /
                  eventCount[event.eventCallback.name]!;
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

          yield* Effect.forEach(
            chainRequests.entries(),
            ([chainId, requests]) =>
              Effect.gen(function* () {
                const i = indexingBuild.chains.findIndex(
                  (n) => n.id === chainId,
                );
                const chain = indexingBuild.chains[i]!;
                const rpc = indexingBuild.rpcs[i]!;

                const dbRequests = requests.filter(
                  ({ ev }) => ev > DB_PREDICTION_THRESHOLD,
                );

                // Note: Without the rpc request cache, all requests miss the database.
                let cachedResults: (string | undefined)[] = [];
                if (chain.cacheRpcRequests) {
                  metrics.ponder_indexing_rpc_prefetch_total.inc(
                    {
                      chain: chain.name,
                      method: "eth_call",
                      type: "database",
                    },
                    dbRequests.length,
                  );

                  cachedResults = yield* getRpcRequestResults(
                    {
                      requests: dbRequests.map(({ request }) => request),
                      chainId,
                    },
                    context,
                  );
                }

                for (let i = 0; i < dbRequests.length; i++) {
                  const request = dbRequests[i]!;
                  const cachedResult = cachedResults[i];

                  if (cachedResult !== undefined) {
                    cache
                      .get(chainId)!
                      .set(getCacheKey(request.request), cachedResult);
                  } else if (request.ev > RPC_PREDICTION_THRESHOLD) {
                    // Note: The request runs in the background, and the first request
                    // of an indexing function that hits the cache awaits it.
                    const result = yield* FiberSet.run(
                      fibers,
                      rpc
                        .request(request.request, context)
                        .pipe(Effect.map((result) => JSON.stringify(result))),
                    );

                    metrics.ponder_indexing_rpc_prefetch_total.inc({
                      chain: chain.name,
                      method: "eth_call",
                      type: "rpc",
                    });

                    cache
                      .get(chainId)!
                      .set(getCacheKey(request.request), result);
                  }
                }

                if (dbRequests.length > 0) {
                  yield* Effect.logDebug({
                    msg: "Prefetched JSON-RPC requests",
                    chain: chain.name,
                    chain_id: chain.id,
                    request_count: dbRequests.length,
                    duration: yield* prefetchEndClock,
                  });
                }
              }),
            { concurrency: "unbounded", discard: true },
          );
        }),
      clear() {
        for (const chain of indexingBuild.chains) {
          cache.get(chain.id)!.clear();
        }
      },
      get event() {
        return event;
      },
      set event(_event: Event | SetupEvent) {
        event = _event;
      },
      finalize: ({ chainId, checkpoint }) =>
        Effect.suspend(() => {
          finalizedCheckpoints.set(chainId, checkpoint);
          const results = unfinalizedResults.get(chainId)!;
          const requests: Parameters<
            SyncStore["insertRpcRequestResults"]
          >[0]["requests"] = [];
          for (const [cacheKey, result] of results) {
            if (result.checkpoint <= checkpoint) {
              requests.push(result);
              results.delete(cacheKey);
            }
          }
          return Effect.forEach(
            Array.from({ length: Math.ceil(requests.length / 1_000) }, (_, i) =>
              requests.slice(i * 1_000, (i + 1) * 1_000),
            ),
            (requests) => writeRpcRequestResults({ requests, chainId }),
            { discard: true },
          );
        }),
      reorg({ chainId, checkpoint }) {
        const results = unfinalizedResults.get(chainId)!;
        for (const [cacheKey, result] of results) {
          if (result.checkpoint > checkpoint) results.delete(cacheKey);
        }
      },
    };

    return cachedViemClient;
  });

const fromPromise = <A>(
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, Error> =>
  Effect.tryPromise({
    try: async () => await evaluate(),
    catch: (error) => error as Error,
  });

export const extractBlockNumberParam = (request: RequestParameters) => {
  let blockNumber: Hex | "latest" | undefined;

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
