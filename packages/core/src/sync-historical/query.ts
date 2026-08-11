import {
  isLastPage,
  type QueryBlocksRequest,
  type QueryLogsRequest,
  type QueryTracesRequest,
  type QueryTransactionsRequest,
  type QueryTransfersRequest,
  type RpcBlockResponse,
  type RpcCallTraceResponse,
  type RpcLogResponse,
  type RpcTransactionResponse,
  updateRequestPagination,
} from "@monad-crypto/query";
import { type Address, type Hex, hexToNumber, numberToHex } from "viem";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Factory,
  Filter,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import {
  eth_queryBlocks,
  eth_queryLogs,
  eth_queryTraces,
  eth_queryTransactions,
  eth_queryTransfers,
} from "@/rpc/actions.js";
import {
  type RequestParameters,
  type RequestReturnType,
  type Rpc,
  sanitizeLogTopics,
} from "@/rpc/index.js";
import {
  getChildAddress,
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
import type {
  ChildAddresses,
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { MakeRequired } from "@/types/utils.js";
import {
  bufferAsyncGenerator,
  mergeAsyncGenerators,
} from "@/utils/generators.js";
import { type Interval, intervalBounds } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import { startClock } from "@/utils/timer.js";

export type QueryHistoricalSync = {
  /** Sync block data and yield each completed query page. */
  syncQueryBlockData(params: {
    requiredIntervals: IntervalWithFilter[];
    requiredFactoryIntervals: IntervalWithFactory[];
    syncStore: SyncStore;
  }): AsyncGenerator<{
    filters: Filter[];
    factories: Factory[];
    interval: Interval[];
    block: SyncBlockHeader | undefined;
  }>;
};

type CreateQueryHistoricalSyncParams = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  childAddresses: Map<string, Map<Address, number>>;
};

type RpcQueryBlocksRequest = QueryBlocksRequest<Hex, Hex>;
type RpcQueryTransactionsRequest = QueryTransactionsRequest<Hex, Hex>;
type RpcQueryLogsRequest = QueryLogsRequest<Hex, Hex>;
type RpcQueryTracesRequest = QueryTracesRequest<Hex, Hex>;
type RpcQueryTransfersRequest = QueryTransfersRequest<Hex, Hex>;

export const createQueryHistoricalSync = (
  params: CreateQueryHistoricalSyncParams,
): QueryHistoricalSync => {
  return {
    async *syncQueryBlockData({
      requiredIntervals,
      requiredFactoryIntervals,
      syncStore,
    }) {
      const context = {
        logger: params.common.logger.child({ action: "fetch_block_data" }),
      };

      const factoryIntervalsById = new Map<
        Factory["id"],
        { factory: Factory; interval: Interval }
      >();

      for (const { factory, interval } of requiredFactoryIntervals) {
        const existing = factoryIntervalsById.get(factory.id);
        factoryIntervalsById.set(factory.id, {
          factory,
          interval: existing
            ? intervalBounds([existing.interval, interval])
            : interval,
        });
      }

      const factoryProgress = new Map<
        Factory["id"],
        {
          // TODO(kyle) jsdoc comment
          block: number;
          endBlock: number;
          pwr: PromiseWithResolvers<void>;
        }
      >();

      for (const { factory, interval } of factoryIntervalsById.values()) {
        factoryProgress.set(factory.id, {
          block: interval[0] - 1,
          endBlock: interval[1],
          pwr: promiseWithResolvers<void>(),
        });
      }

      const factoryGenerators = Array.from(factoryIntervalsById.values()).map(
        ({ factory, interval: factoryInterval }) =>
          (async function* () {
            const progress = factoryProgress.get(factory.id)!;

            const factoryChildAddresses = params.childAddresses.get(
              factory.id,
            )!;

            const request = {
              fromBlock: numberToHex(factoryInterval[0]),
              toBlock: numberToHex(factoryInterval[1]),
              filter: {
                address: factory.address,
                topics: [factory.eventSelector],
              },
              // TODO(kyle) field selection
              fields: { logs: true },
            } as RpcQueryLogsRequest;

            for await (const { response, endClock } of bufferAsyncGenerator(
              paginateQueryRequest(
                params.rpc,
                "eth_queryLogs",
                request,
                context,
              ),
              1,
            )) {
              const childAddresses = new Map<Address, number>();

              for (const queryLog of response.data.logs) {
                const log = queryLogToSyncLog(queryLog);
                if (isLogFactoryMatched({ factory, log }) === false) continue;

                let address: Address;
                try {
                  address = getChildAddress({ log, factory });
                } catch (error) {
                  if (factory.address !== undefined) throw error;
                  params.common.logger.debug({
                    msg: "Failed to extract child address from log matched by factory using the provided ABI item",
                    chain: params.chain.name,
                    chain_id: params.chain.id,
                    factory: factory.sourceId,
                    block_number: hexToNumber(log.blockNumber),
                    log_index: hexToNumber(log.logIndex),
                    data: log.data,
                    topics: JSON.stringify(log.topics),
                  });
                  continue;
                }

                const blockNumber = hexToNumber(log.blockNumber);
                const existingBlockNumber = factoryChildAddresses.get(address);
                if (
                  existingBlockNumber === undefined ||
                  existingBlockNumber > blockNumber
                ) {
                  childAddresses.set(address, blockNumber);
                  factoryChildAddresses.set(address, blockNumber);
                }
              }

              if (childAddresses.size > 0) {
                await syncStore.insertChildAddresses(
                  {
                    factory,
                    childAddresses,
                    chainId: params.chain.id,
                  },
                  context,
                );
              }

              const interval = getQueryPageInterval(response);
              const previousPwr = progress.pwr;
              progress.block = interval[1];
              progress.pwr = promiseWithResolvers<void>();
              previousPwr.resolve();

              params.common.logger.debug(
                {
                  msg: "Fetched block range data",
                  chain: params.chain.name,
                  chain_id: params.chain.id,
                  data_type: "factory_log",
                  block_range: JSON.stringify(interval),
                  log_count: response.data.logs.length,
                  child_address_count: childAddresses.size,
                  duration: endClock(),
                },
                ["chain", "data_type", "block_range"],
              );

              yield {
                filters: [],
                factories: [factory],
                interval: [interval],
                block: undefined,
              };
            }
          })(),
      );

      const factoryAddressMatches = (
        value: Address | Address[] | Factory | undefined,
        valueToMatch: Address | null | undefined,
        blockNumber: number,
      ) =>
        isAddressFactory(value)
          ? valueToMatch !== null &&
            valueToMatch !== undefined &&
            isAddressMatched({
              address: valueToMatch,
              blockNumber,
              childAddresses: params.childAddresses.get(value.id) ?? new Map(),
            })
          : true;

      const requestsWithFilters =
        mergeFiltersToQueryRequests(requiredIntervals);

      const insertedBlocks = new Set<Hex>();
      const insertedTransactions = new Set<`${Hex}_${Hex}`>();
      const insertedTransactionReceipts = new Set<`${Hex}_${Hex}`>();
      const insertedTraces = new Set<`${Hex}_${Hex}_${number}`>();
      const insertedTransfers = new Set<`${Hex}_${Hex}_${number}`>();
      const insertedLogs = new Set<`${Hex}_${Hex}`>();

      const requestGenerators: ReturnType<
        QueryHistoricalSync["syncQueryBlockData"]
      >[] = [];

      for (const _requestWithFilters of requestsWithFilters) {
        requestGenerators.push(
          (async function* () {
            const requestWithFilters = materializeQueryRequest(
              _requestWithFilters,
              params.childAddresses,
              params.common.options,
            );

            switch (requestWithFilters.method) {
              case "eth_queryBlocks": {
                for await (const { response, endClock } of bufferAsyncGenerator(
                  paginateQueryRequest(
                    params.rpc,
                    "eth_queryBlocks",
                    requestWithFilters.params[0] as RpcQueryBlocksRequest,
                    context,
                  ),
                  1,
                )) {
                  const blocks: SyncBlockHeader[] = [];

                  for (const queryBlock of response.data.blocks) {
                    const block = queryBlockToSyncBlockHeader(queryBlock);
                    for (const filter of requestWithFilters.filters) {
                      if (
                        filter.type === "block" &&
                        isBlockFilterMatched({ filter, block })
                      ) {
                        blocks.push(block);
                        break;
                      }
                    }
                  }

                  const blocksToInsert = blocks.filter((block) => {
                    if (insertedBlocks.has(block.number)) return false;
                    insertedBlocks.add(block.number);
                    return true;
                  });

                  const pageClosestToTipBlock = getClosestToTipBlock(blocks);

                  await syncStore.insertBlocks(
                    { blocks: blocksToInsert, chainId: params.chain.id },
                    context,
                  );

                  const interval = getQueryPageInterval(response);
                  params.common.logger.debug(
                    {
                      msg: "Fetched block data",
                      chain: params.chain.name,
                      chain_id: params.chain.id,
                      data_type: "block",
                      block_range: JSON.stringify(interval),
                      block_count: blocksToInsert.length,
                      duration: endClock(),
                    },
                    ["chain", "data_type", "block_range"],
                  );

                  yield {
                    filters: requestWithFilters.filters,
                    factories: [],
                    interval: [interval],
                    block: pageClosestToTipBlock,
                  };
                }
                break;
              }
              case "eth_queryTransactions": {
                if (
                  requestWithFilters.params[0].filter?.from?.length === 0 ||
                  requestWithFilters.params[0].filter?.to?.length === 0
                )
                  return;

                for await (const { response, endClock } of bufferAsyncGenerator(
                  paginateQueryRequest(
                    params.rpc,
                    "eth_queryTransactions",
                    requestWithFilters.params[0] as RpcQueryTransactionsRequest,
                    context,
                  ),
                  1,
                )) {
                  const transactions: SyncTransaction[] = [];
                  const transactionReceipts: SyncTransactionReceipt[] = [];
                  const blocks = response.data.blocks!.map(
                    queryBlockToSyncBlockHeader,
                  );

                  for (const queryTransaction of response.data.transactions) {
                    const transaction =
                      queryTransactionToSyncTransaction(queryTransaction);

                    for (const filter of requestWithFilters.filters) {
                      const blockNumber = Number(transaction.blockNumber);
                      if (
                        filter.type === "transaction" &&
                        isTransactionFilterMatched({ filter, transaction }) &&
                        factoryAddressMatches(
                          filter.fromAddress,
                          transaction.from,
                          blockNumber,
                        ) &&
                        factoryAddressMatches(
                          filter.toAddress,
                          transaction.to,
                          blockNumber,
                        )
                      ) {
                        transactions.push(transaction);
                        transactionReceipts.push(
                          queryTransactionToSyncTransactionReceipt(
                            queryTransaction,
                          ),
                        );
                        break;
                      }
                    }
                  }

                  const transactionsToInsert = transactions.filter(
                    (transaction) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
                      if (insertedTransactions.has(key)) return false;
                      insertedTransactions.add(key);
                      return true;
                    },
                  );
                  const transactionReceiptsToInsert =
                    transactionReceipts.filter((transaction) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
                      if (insertedTransactionReceipts.has(key)) return false;
                      insertedTransactionReceipts.add(key);
                      return true;
                    });
                  const blocksToInsert = blocks.filter((block) => {
                    if (insertedBlocks.has(block.number)) return false;
                    insertedBlocks.add(block.number);
                    return true;
                  });

                  const pageClosestToTipBlock = getClosestToTipBlock(blocks);

                  await promiseAllSettledWithThrow([
                    syncStore.insertBlocks(
                      { blocks: blocksToInsert, chainId: params.chain.id },
                      context,
                    ),
                    syncStore.insertTransactions(
                      {
                        transactions: transactionsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertTransactionReceipts(
                      {
                        transactionReceipts: transactionReceiptsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                  ]);

                  const interval = getQueryPageInterval(response);
                  params.common.logger.debug(
                    {
                      msg: "Fetched block data",
                      chain: params.chain.name,
                      chain_id: params.chain.id,
                      data_type: "transaction",
                      block_range: JSON.stringify(interval),
                      block_count: blocksToInsert.length,
                      transaction_count: transactionsToInsert.length,
                      receipt_count: transactionReceiptsToInsert.length,
                      duration: endClock(),
                    },
                    ["chain", "data_type", "block_range"],
                  );

                  yield {
                    filters: requestWithFilters.filters,
                    factories: [],
                    interval: [interval],
                    block: pageClosestToTipBlock,
                  };
                }
                break;
              }
              case "eth_queryLogs": {
                if (requestWithFilters.params[0].filter?.address?.length === 0)
                  return;

                for await (const { response, endClock } of bufferAsyncGenerator(
                  paginateQueryRequest(
                    params.rpc,
                    "eth_queryLogs",
                    requestWithFilters.params[0] as RpcQueryLogsRequest,
                    context,
                  ),
                  1,
                )) {
                  const logs: SyncLog[] = [];
                  const blocks = response.data.blocks!.map(
                    queryBlockToSyncBlockHeader,
                  );
                  const transactions = response.data.transactions!.map(
                    queryTransactionToSyncTransaction,
                  );
                  const transactionReceipts = response.data.transactions!.map(
                    queryTransactionToSyncTransactionReceipt,
                  );
                  const matchedTransactionReceipts = new Set<`${Hex}_${Hex}`>();

                  for (const queryLog of response.data.logs) {
                    const log = queryLogToSyncLog(queryLog);
                    let isMatched = false;
                    for (const filter of requestWithFilters.filters) {
                      const blockNumber = Number(log.blockNumber);
                      if (
                        filter.type === "log" &&
                        isLogFilterMatched({ filter, log }) &&
                        factoryAddressMatches(
                          filter.address,
                          log.address,
                          blockNumber,
                        )
                      ) {
                        isMatched = true;
                        if (filter.hasTransactionReceipt) {
                          matchedTransactionReceipts.add(
                            `${log.blockNumber}_${log.transactionIndex}`,
                          );
                          break;
                        }
                      }
                    }

                    if (isMatched) {
                      logs.push(log);
                    }
                  }

                  const blocksToInsert = blocks.filter((block) => {
                    if (insertedBlocks.has(block.number)) return false;
                    insertedBlocks.add(block.number);
                    return true;
                  });
                  const transactionsToInsert = transactions.filter(
                    (transaction) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
                      if (insertedTransactions.has(key)) return false;
                      insertedTransactions.add(key);
                      return true;
                    },
                  );
                  const transactionReceiptsToInsert =
                    transactionReceipts.filter((transactionReceipt) => {
                      const key =
                        `${transactionReceipt.blockNumber}_${transactionReceipt.transactionIndex}` as const;
                      if (
                        insertedTransactionReceipts.has(key) ||
                        matchedTransactionReceipts.has(key) === false
                      )
                        return false;
                      insertedTransactionReceipts.add(key);
                      return true;
                    });
                  const logsToInsert = logs.filter((log) => {
                    const key = `${log.blockNumber}_${log.logIndex}` as const;
                    if (insertedLogs.has(key)) return false;
                    insertedLogs.add(key);
                    return true;
                  });

                  const pageClosestToTipBlock = getClosestToTipBlock(blocks);

                  await promiseAllSettledWithThrow([
                    syncStore.insertBlocks(
                      { blocks: blocksToInsert, chainId: params.chain.id },
                      context,
                    ),
                    syncStore.insertTransactions(
                      {
                        transactions: transactionsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertTransactionReceipts(
                      {
                        transactionReceipts: transactionReceiptsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertLogs(
                      { logs: logsToInsert, chainId: params.chain.id },
                      context,
                    ),
                  ]);

                  const interval = getQueryPageInterval(response);
                  params.common.logger.debug(
                    {
                      msg: "Fetched block data",
                      chain: params.chain.name,
                      chain_id: params.chain.id,
                      data_type: "log",
                      block_range: JSON.stringify(interval),
                      block_count: blocksToInsert.length,
                      transaction_count: transactionsToInsert.length,
                      receipt_count: transactionReceiptsToInsert.length,
                      log_count: logsToInsert.length,
                      duration: endClock(),
                    },
                    ["chain", "data_type", "block_range"],
                  );

                  yield {
                    filters: requestWithFilters.filters,
                    factories: [],
                    interval: [interval],
                    block: pageClosestToTipBlock,
                  };
                }
                break;
              }
              case "eth_queryTraces": {
                if (
                  requestWithFilters.params[0].filter?.from?.length === 0 ||
                  requestWithFilters.params[0].filter?.to?.length === 0
                )
                  return;

                for await (const { response, endClock } of bufferAsyncGenerator(
                  paginateQueryRequest(
                    params.rpc,
                    "eth_queryTraces",
                    requestWithFilters.params[0] as RpcQueryTracesRequest,
                    context,
                  ),
                  1,
                )) {
                  const traces: SyncTrace[] = [];
                  const blocks = response.data.blocks!.map(
                    queryBlockToSyncBlockHeader,
                  );
                  const transactions = response.data.transactions!.map(
                    queryTransactionToSyncTransaction,
                  );
                  const transactionReceipts = response.data.transactions!.map(
                    queryTransactionToSyncTransactionReceipt,
                  );
                  const transactionsByHash = new Map<Hex, SyncTransaction>();
                  const blocksByNumber = new Map<Hex, SyncBlockHeader>();
                  const matchedTransactionReceipts = new Set<`${Hex}_${Hex}`>();

                  for (const block of blocks)
                    blocksByNumber.set(block.number, block);
                  for (const transaction of transactions) {
                    transactionsByHash.set(transaction.hash, transaction);
                  }

                  const sortedTraces = response.data.traces.sort((a, b) =>
                    String(a.traceAddress) > String(b.traceAddress) ? 1 : -1,
                  );

                  for (const [index, queryTrace] of sortedTraces.entries()) {
                    const trace = queryTraceToSyncTrace(queryTrace, index);
                    const transaction = transactionsByHash.get(
                      trace.transactionHash,
                    )!;
                    const block = blocksByNumber.get(transaction.blockNumber)!;

                    let isMatched = false;
                    for (const filter of requestWithFilters.filters) {
                      const blockNumber = Number(block.number);
                      if (
                        filter.type === "trace" &&
                        isTraceFilterMatched({
                          filter,
                          trace: trace.trace,
                          block,
                        }) &&
                        factoryAddressMatches(
                          filter.fromAddress,
                          trace.trace.from,
                          blockNumber,
                        ) &&
                        factoryAddressMatches(
                          filter.toAddress,
                          trace.trace.to,
                          blockNumber,
                        )
                      ) {
                        isMatched = true;
                        if (filter.hasTransactionReceipt) {
                          matchedTransactionReceipts.add(
                            `${transaction.blockNumber}_${transaction.transactionIndex}`,
                          );
                          break;
                        }
                      }
                    }
                    if (isMatched) traces.push(trace);
                  }

                  const blocksToInsert = blocks.filter((block) => {
                    if (insertedBlocks.has(block.number)) return false;
                    insertedBlocks.add(block.number);
                    return true;
                  });
                  const transactionsToInsert = transactions.filter(
                    (transaction) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
                      if (insertedTransactions.has(key)) return false;
                      insertedTransactions.add(key);
                      return true;
                    },
                  );
                  const transactionReceiptsToInsert =
                    transactionReceipts.filter((transactionReceipt) => {
                      const key =
                        `${transactionReceipt.blockNumber}_${transactionReceipt.transactionIndex}` as const;
                      if (
                        insertedTransactionReceipts.has(key) ||
                        matchedTransactionReceipts.has(key) === false
                      )
                        return false;
                      insertedTransactionReceipts.add(key);
                      return true;
                    });
                  const tracesToInsert = traces
                    .map((trace) => {
                      const transaction = transactionsByHash.get(
                        trace.transactionHash,
                      )!;
                      const block = blocksByNumber.get(
                        transaction.blockNumber,
                      )!;
                      return { trace, block, transaction };
                    })
                    .filter(({ trace, transaction }) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}_${trace.trace.index}` as const;
                      if (insertedTraces.has(key)) return false;
                      insertedTraces.add(key);
                      return true;
                    });

                  const pageClosestToTipBlock = getClosestToTipBlock(blocks);

                  await promiseAllSettledWithThrow([
                    syncStore.insertBlocks(
                      { blocks: blocksToInsert, chainId: params.chain.id },
                      context,
                    ),
                    syncStore.insertTransactions(
                      {
                        transactions: transactionsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertTransactionReceipts(
                      {
                        transactionReceipts: transactionReceiptsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertTraces(
                      { traces: tracesToInsert, chainId: params.chain.id },
                      context,
                    ),
                  ]);

                  const interval = getQueryPageInterval(response);
                  params.common.logger.debug(
                    {
                      msg: "Fetched block data",
                      chain: params.chain.name,
                      chain_id: params.chain.id,
                      data_type: "trace",
                      block_range: JSON.stringify(interval),
                      block_count: blocksToInsert.length,
                      transaction_count: transactionsToInsert.length,
                      receipt_count: transactionReceiptsToInsert.length,
                      trace_count: tracesToInsert.length,
                      duration: endClock(),
                    },
                    ["chain", "data_type", "block_range"],
                  );

                  yield {
                    filters: requestWithFilters.filters,
                    factories: [],
                    interval: [interval],
                    block: pageClosestToTipBlock,
                  };
                }
                break;
              }
              case "eth_queryTransfers": {
                if (
                  requestWithFilters.params[0].filter?.from?.length === 0 ||
                  requestWithFilters.params[0].filter?.to?.length === 0
                )
                  return;

                for await (const { response, endClock } of bufferAsyncGenerator(
                  paginateQueryRequest(
                    params.rpc,
                    "eth_queryTransfers",
                    requestWithFilters.params[0] as RpcQueryTransfersRequest,
                    context,
                  ),
                  1,
                )) {
                  const traces: SyncTrace[] = [];
                  const blocks = response.data.blocks!.map(
                    queryBlockToSyncBlockHeader,
                  );
                  const transactions = response.data.transactions!.map(
                    queryTransactionToSyncTransaction,
                  );
                  const transactionReceipts = response.data.transactions!.map(
                    queryTransactionToSyncTransactionReceipt,
                  );
                  const transactionsByHash = new Map<Hex, SyncTransaction>();
                  const blocksByNumber = new Map<Hex, SyncBlockHeader>();
                  const matchedTransactionReceipts = new Set<`${Hex}_${Hex}`>();

                  for (const block of blocks)
                    blocksByNumber.set(block.number, block);
                  for (const transaction of transactions) {
                    transactionsByHash.set(transaction.hash, transaction);
                  }

                  const sortedTransfers = response.data.transfers.sort(
                    (a, b) =>
                      String(a.traceAddress) > String(b.traceAddress) ? 1 : -1,
                  );

                  for (const [
                    index,
                    queryTransfer,
                  ] of sortedTransfers.entries()) {
                    const trace = queryTraceToSyncTrace(queryTransfer, index);
                    const transaction = transactionsByHash.get(
                      trace.transactionHash,
                    )!;
                    const block = blocksByNumber.get(transaction.blockNumber)!;

                    let isMatched = false;
                    for (const filter of requestWithFilters.filters) {
                      const blockNumber = Number(block.number);
                      if (
                        filter.type === "transfer" &&
                        isTransferFilterMatched({
                          filter,
                          trace: trace.trace,
                          block,
                        }) &&
                        factoryAddressMatches(
                          filter.fromAddress,
                          trace.trace.from,
                          blockNumber,
                        ) &&
                        factoryAddressMatches(
                          filter.toAddress,
                          trace.trace.to,
                          blockNumber,
                        )
                      ) {
                        isMatched = true;
                        if (filter.hasTransactionReceipt) {
                          matchedTransactionReceipts.add(
                            `${transaction.blockNumber}_${transaction.transactionIndex}`,
                          );
                          break;
                        }
                      }
                    }
                    if (isMatched) traces.push(trace);
                  }

                  const blocksToInsert = blocks.filter((block) => {
                    if (insertedBlocks.has(block.number)) return false;
                    insertedBlocks.add(block.number);
                    return true;
                  });
                  const transactionsToInsert = transactions.filter(
                    (transaction) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
                      if (insertedTransactions.has(key)) return false;
                      insertedTransactions.add(key);
                      return true;
                    },
                  );
                  const transactionReceiptsToInsert =
                    transactionReceipts.filter((transactionReceipt) => {
                      const key =
                        `${transactionReceipt.blockNumber}_${transactionReceipt.transactionIndex}` as const;
                      if (
                        insertedTransactionReceipts.has(key) ||
                        matchedTransactionReceipts.has(key) === false
                      )
                        return false;
                      insertedTransactionReceipts.add(key);
                      return true;
                    });
                  const tracesToInsert = traces
                    .map((trace) => {
                      const transaction = transactionsByHash.get(
                        trace.transactionHash,
                      )!;
                      const block = blocksByNumber.get(
                        transaction.blockNumber,
                      )!;
                      return { trace, block, transaction };
                    })
                    .filter(({ trace, transaction }) => {
                      const key =
                        `${transaction.blockNumber}_${transaction.transactionIndex}_${trace.trace.index}` as const;
                      if (insertedTransfers.has(key)) return false;
                      insertedTransfers.add(key);
                      return true;
                    });

                  const pageClosestToTipBlock = getClosestToTipBlock(blocks);

                  await promiseAllSettledWithThrow([
                    syncStore.insertBlocks(
                      { blocks: blocksToInsert, chainId: params.chain.id },
                      context,
                    ),
                    syncStore.insertTransactions(
                      {
                        transactions: transactionsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertTransactionReceipts(
                      {
                        transactionReceipts: transactionReceiptsToInsert,
                        chainId: params.chain.id,
                      },
                      context,
                    ),
                    syncStore.insertTraces(
                      { traces: tracesToInsert, chainId: params.chain.id },
                      context,
                    ),
                  ]);

                  const interval = getQueryPageInterval(response);
                  params.common.logger.debug(
                    {
                      msg: "Fetched block data",
                      chain: params.chain.name,
                      chain_id: params.chain.id,
                      data_type: "transfer",
                      block_range: JSON.stringify(interval),
                      block_count: blocksToInsert.length,
                      transaction_count: transactionsToInsert.length,
                      receipt_count: transactionReceiptsToInsert.length,
                      transfer_count: tracesToInsert.length,
                      duration: endClock(),
                    },
                    ["chain", "data_type", "block_range"],
                  );

                  yield {
                    filters: requestWithFilters.filters,
                    factories: [],
                    interval: [interval],
                    block: pageClosestToTipBlock,
                  };
                }
                break;
              }
            }
          })(),
        );
      }

      yield* mergeAsyncGenerators([...factoryGenerators, ...requestGenerators]);
    },
  };
};

const queryBlockToSyncBlockHeader = (
  block: RpcBlockResponse,
): SyncBlockHeader => ({
  ...block,
  transactions: undefined,
  withdrawals: undefined,
  sealFields: undefined,
  uncles: undefined,
});

const getClosestToTipBlock = (
  blocks: Iterable<SyncBlockHeader>,
): SyncBlockHeader | undefined => {
  let closestToTipBlock: SyncBlockHeader | undefined;

  for (const block of blocks) {
    if (
      closestToTipBlock === undefined ||
      Number(block.number) > Number(closestToTipBlock.number)
    ) {
      closestToTipBlock = block;
    }
  }

  return closestToTipBlock;
};

const getQueryPageInterval = (response: {
  fromBlock: { number: Hex };
  cursorBlock: { number: Hex };
}): Interval => [
  hexToNumber(response.fromBlock.number),
  hexToNumber(response.cursorBlock.number),
];

const queryTransactionToSyncTransaction = (
  transaction: RpcTransactionResponse,
): SyncTransaction => transaction;

const queryTransactionToSyncTransactionReceipt = (
  transaction: RpcTransactionResponse,
): SyncTransactionReceipt => {
  // @ts-expect-error
  const transactionReceipt = transaction as SyncTransactionReceipt;

  transactionReceipt.transactionHash = transaction.hash;

  // TODO: Remove this temporary fallback once eth_query responses include status.
  if (transactionReceipt.status === undefined) {
    transactionReceipt.status = "0x1";
  }

  return transactionReceipt;
};

const queryLogToSyncLog = (log: RpcLogResponse): SyncLog => log;

const queryTraceToSyncTrace = (
  trace: RpcCallTraceResponse,
  index: number,
): SyncTrace => {
  // @ts-expect-error
  const syncTrace = trace as SyncTrace["trace"];
  const transactionHash = trace.transactionHash;

  // @ts-expect-error
  trace.blockHash = undefined;
  // @ts-expect-error
  trace.blockNumber = undefined;
  // @ts-expect-error
  trace.transactionIndex = undefined;
  // @ts-expect-error
  trace.traceAddress = undefined;

  syncTrace.index = index;
  syncTrace.subcalls = 0;
  if (syncTrace.input === undefined) syncTrace.input = "0x";
  if (trace.status === "0x0" && syncTrace.error === undefined) {
    syncTrace.error = "execution reverted";
  }

  return {
    transactionHash,
    trace: syncTrace,
  };
};

const mergeFilterValue = <value extends Hex>(
  left: value | value[] | undefined,
  right: value | value[] | undefined,
): value[] | undefined =>
  left === undefined || right === undefined
    ? undefined
    : [
        ...new Set([
          ...(Array.isArray(left) ? left : [left]),
          ...(Array.isArray(right) ? right : [right]),
        ]),
      ];

const queryFilterKeys = {
  eth_queryBlocks: [],
  eth_queryTransactions: ["from", "to"],
  eth_queryTraces: ["from", "to", "selector"],
  eth_queryLogs: ["address", "topic0", "topic1", "topic2", "topic3"],
  eth_queryTransfers: ["from", "to"],
} as const;

type QueryRequest = (
  | Extract<RequestParameters, { method: "eth_queryBlocks" }>
  | Extract<RequestParameters, { method: "eth_queryTransactions" }>
  | Extract<RequestParameters, { method: "eth_queryTraces" }>
  | Extract<RequestParameters, { method: "eth_queryLogs" }>
  | Extract<RequestParameters, { method: "eth_queryTransfers" }>
) & {
  filters: Filter[];
  factories: Partial<{ [address in "address" | "from" | "to"]: Factory["id"] }>;
};

const mergeFiltersToQueryRequests = (
  filters: IntervalWithFilter[],
): QueryRequest[] => {
  type BlockRequest = RpcQueryBlocksRequest & { filters: Filter[] };
  type TransactionRequest = MakeRequired<
    RpcQueryTransactionsRequest,
    "filter"
  > & {
    filters: Filter[];
    factories: Partial<{ [address in "from" | "to"]: Factory["id"] }>;
  };
  type TraceRequest = MakeRequired<RpcQueryTracesRequest, "filter"> & {
    filters: Filter[];
    factories: Partial<{ [address in "from" | "to"]: Factory["id"] }>;
  };
  type LogRequest = Omit<RpcQueryLogsRequest, "filter"> & {
    filter: {
      [key in (typeof queryFilterKeys.eth_queryLogs)[number]]:
        | Hex
        | Hex[]
        | undefined;
    };
    filters: Filter[];
    factories: Partial<{ address: Factory["id"] }>;
  };
  type TransferRequest = MakeRequired<RpcQueryTransfersRequest, "filter"> & {
    filters: Filter[];
    factories: Partial<{ [address in "from" | "to"]: Factory["id"] }>;
  };

  const hasSufficientIntervalOverlap = (
    left: Interval,
    right: Interval,
  ): boolean => {
    const overlapStart = Math.max(left[0], right[0]);
    const overlapEnd = Math.min(left[1], right[1]);
    if (overlapStart > overlapEnd) return false;

    const overlapLength = overlapEnd - overlapStart + 1;
    const smallerIntervalLength = Math.min(
      left[1] - left[0] + 1,
      right[1] - right[0] + 1,
    );

    return overlapLength / smallerIntervalLength >= 0.8;
  };

  const getFactoryId = (
    address: Address | Address[] | Factory | undefined,
  ): Factory["id"] | undefined =>
    isAddressFactory(address) ? address.id : undefined;

  const blockRequestParams: BlockRequest[] = [];
  const transactionRequestParams: TransactionRequest[] = [];
  const traceRequestParams: TraceRequest[] = [];
  const logRequestParams: LogRequest[] = [];
  const transferRequestParams: TransferRequest[] = [];

  for (const { filter, interval: filterInterval } of filters) {
    const range = {
      fromBlock: numberToHex(filterInterval[0]),
      toBlock: numberToHex(filterInterval[1]),
    };

    switch (filter.type) {
      case "block": {
        blockRequestParams.push({
          ...range,
          fields: { blocks: true },
          filters: [filter],
        });
        break;
      }
      case "transaction": {
        const transactionRequestFilter = {
          from: filter.fromAddress,
          to: filter.toAddress,
        } as Exclude<RpcQueryTransactionsRequest["filter"], undefined>;

        let isMerged = false;
        for (const mergedRequest of transactionRequestParams) {
          if (
            hasSufficientIntervalOverlap(
              [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
              filterInterval,
            ) === false
          ) {
            continue;
          }

          if (
            mergedRequest.factories.from !== getFactoryId(filter.fromAddress) ||
            mergedRequest.factories.to !== getFactoryId(filter.toAddress)
          ) {
            continue;
          }

          const numberFilterDiff = queryFilterKeys.eth_queryTransactions.filter(
            (key) =>
              JSON.stringify(mergedRequest.filter[key]) !==
              JSON.stringify(transactionRequestFilter[key]),
          ).length;
          if (numberFilterDiff > 1) continue;

          for (const key of queryFilterKeys.eth_queryTransactions) {
            const left = mergedRequest.filter[key];
            const right = transactionRequestFilter[key];
            if (JSON.stringify(left) === JSON.stringify(right)) continue;

            mergedRequest.filter[key] = mergeFilterValue(left, right);
          }

          const mergedInterval = intervalBounds([
            [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
            filterInterval,
          ]);
          mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
          mergedRequest.toBlock = numberToHex(mergedInterval[1]);
          mergedRequest.filters.push(filter);
          isMerged = true;
          break;
        }

        if (isMerged === false) {
          transactionRequestParams.push({
            ...range,
            filter: transactionRequestFilter,
            fields: { blocks: true, transactions: true },
            filters: [filter],
            factories: {
              from: getFactoryId(filter.fromAddress),
              to: getFactoryId(filter.toAddress),
            },
          });
        }
        break;
      }
      case "log": {
        const logRequestFilter = {
          address: filter.address,
          topic0: filter.topic0,
          topic1: filter.topic1 ?? undefined,
          topic2: filter.topic2 ?? undefined,
          topic3: filter.topic3 ?? undefined,
        } as LogRequest["filter"];

        let isMerged = false;
        for (const mergedRequest of logRequestParams) {
          if (
            hasSufficientIntervalOverlap(
              [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
              filterInterval,
            ) === false
          ) {
            continue;
          }

          if (
            mergedRequest.factories.address !== getFactoryId(filter.address)
          ) {
            continue;
          }

          const numberFilterDiff = queryFilterKeys.eth_queryLogs.filter(
            (key) =>
              JSON.stringify(mergedRequest.filter[key]) !==
              JSON.stringify(logRequestFilter[key]),
          ).length;
          if (numberFilterDiff > 1) continue;

          for (const key of queryFilterKeys.eth_queryLogs) {
            const left = mergedRequest.filter[key];
            const right = logRequestFilter[key];
            if (JSON.stringify(left) === JSON.stringify(right)) continue;

            mergedRequest.filter[key] = mergeFilterValue(left, right);
          }

          const mergedInterval = intervalBounds([
            [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
            filterInterval,
          ]);
          mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
          mergedRequest.toBlock = numberToHex(mergedInterval[1]);
          mergedRequest.filters.push(filter);
          isMerged = true;
          break;
        }

        if (isMerged === false) {
          logRequestParams.push({
            ...range,
            filter: logRequestFilter,
            fields: { blocks: true, transactions: true, logs: true },
            filters: [filter],
            factories: {
              address: getFactoryId(filter.address),
            },
          });
        }
        break;
      }
      case "trace": {
        const traceRequestFilter = {
          from: filter.fromAddress,
          to: filter.toAddress,
          selector: filter.functionSelector,
        } as Exclude<RpcQueryTracesRequest["filter"], undefined>;

        let isMerged = false;
        for (const mergedRequest of traceRequestParams) {
          if (
            hasSufficientIntervalOverlap(
              [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
              filterInterval,
            ) === false
          ) {
            continue;
          }

          if (
            mergedRequest.factories.from !== getFactoryId(filter.fromAddress) ||
            mergedRequest.factories.to !== getFactoryId(filter.toAddress)
          ) {
            continue;
          }

          const numberFilterDiff = queryFilterKeys.eth_queryTraces.filter(
            (key) =>
              JSON.stringify(mergedRequest.filter[key]) !==
              JSON.stringify(traceRequestFilter[key]),
          ).length;
          if (numberFilterDiff > 1) continue;

          for (const key of queryFilterKeys.eth_queryTraces) {
            const left = mergedRequest.filter[key];
            const right = traceRequestFilter[key];
            if (JSON.stringify(left) === JSON.stringify(right)) continue;

            mergedRequest.filter[key] = mergeFilterValue(left, right);
          }

          const mergedInterval = intervalBounds([
            [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
            filterInterval,
          ]);
          mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
          mergedRequest.toBlock = numberToHex(mergedInterval[1]);
          mergedRequest.filters.push(filter);
          isMerged = true;
          break;
        }

        if (isMerged === false) {
          traceRequestParams.push({
            ...range,
            filter: traceRequestFilter,
            fields: { blocks: true, transactions: true, traces: true },
            filters: [filter],
            factories: {
              from: getFactoryId(filter.fromAddress),
              to: getFactoryId(filter.toAddress),
            },
          });
        }
        break;
      }
      case "transfer": {
        const transferRequestFilter = {
          from: filter.fromAddress,
          to: filter.toAddress,
        } as Exclude<RpcQueryTransfersRequest["filter"], undefined>;

        let isMerged = false;
        for (const mergedRequest of transferRequestParams) {
          if (
            hasSufficientIntervalOverlap(
              [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
              filterInterval,
            ) === false
          ) {
            continue;
          }

          if (
            mergedRequest.factories.from !== getFactoryId(filter.fromAddress) ||
            mergedRequest.factories.to !== getFactoryId(filter.toAddress)
          ) {
            continue;
          }

          const numberFilterDiff = queryFilterKeys.eth_queryTransfers.filter(
            (key) =>
              JSON.stringify(mergedRequest.filter[key]) !==
              JSON.stringify(transferRequestFilter[key]),
          ).length;
          if (numberFilterDiff > 1) continue;

          for (const key of queryFilterKeys.eth_queryTransfers) {
            const left = mergedRequest.filter[key];
            const right = transferRequestFilter[key];
            if (JSON.stringify(left) === JSON.stringify(right)) continue;

            mergedRequest.filter[key] = mergeFilterValue(left, right);
          }

          const mergedInterval = intervalBounds([
            [Number(mergedRequest.fromBlock), Number(mergedRequest.toBlock)],
            filterInterval,
          ]);
          mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
          mergedRequest.toBlock = numberToHex(mergedInterval[1]);
          mergedRequest.filters.push(filter);
          isMerged = true;
          break;
        }

        if (isMerged === false) {
          transferRequestParams.push({
            ...range,
            filter: transferRequestFilter,
            fields: { blocks: true, transactions: true, transfers: true },
            filters: [filter],
            factories: {
              from: getFactoryId(filter.fromAddress),
              to: getFactoryId(filter.toAddress),
            },
          });
        }
        break;
      }
    }
  }

  const requests: QueryRequest[] = [
    ...blockRequestParams.map(({ filters, ...request }) => ({
      method: "eth_queryBlocks" as const,
      params: [request] as [RpcQueryBlocksRequest],
      filters,
      factories: {},
    })),
    ...transactionRequestParams.map(({ filters, factories, ...request }) => ({
      method: "eth_queryTransactions" as const,
      params: [request] as [RpcQueryTransactionsRequest],
      filters,
      factories,
    })),
    ...logRequestParams.map(({ filters, factories, filter, ...request }) => ({
      method: "eth_queryLogs" as const,
      params: [
        {
          ...request,
          filter: {
            address: filter.address,
            topics: sanitizeLogTopics([
              filter.topic0 ?? null,
              filter.topic1 ?? null,
              filter.topic2 ?? null,
              filter.topic3 ?? null,
            ]),
          },
        },
      ] as [RpcQueryLogsRequest],
      filters,
      factories,
    })),
    ...traceRequestParams.map(({ filters, factories, ...request }) => ({
      method: "eth_queryTraces" as const,
      params: [request] as [RpcQueryTracesRequest],
      filters,
      factories,
    })),
    ...transferRequestParams.map(({ filters, factories, ...request }) => ({
      method: "eth_queryTransfers" as const,
      params: [request] as [RpcQueryTransfersRequest],
      filters,
      factories,
    })),
  ];

  return requests;
};

const materializeQueryRequest = (
  queryRequest: QueryRequest,
  childAddresses: ChildAddresses,
  options: Common["options"],
): QueryRequest => {
  const resolveFactory = (factoryId: Factory["id"]): Address[] | undefined => {
    const addresses = childAddresses.get(factoryId) ?? new Map();
    return addresses.size >= options.factoryAddressCountThreshold
      ? undefined
      : Array.from(addresses.keys());
  };

  switch (queryRequest.method) {
    case "eth_queryBlocks":
      return queryRequest;
    case "eth_queryLogs": {
      const factoryId = queryRequest.factories.address;
      if (factoryId === undefined) return queryRequest;

      const request = queryRequest.params[0];
      return {
        ...queryRequest,
        params: [
          {
            ...request,
            filter: {
              ...request.filter,
              address: resolveFactory(factoryId),
            },
          },
        ],
      };
    }
    case "eth_queryTransactions": {
      const fromFactoryId = queryRequest.factories.from;
      const toFactoryId = queryRequest.factories.to;
      if (fromFactoryId === undefined && toFactoryId === undefined) {
        return queryRequest;
      }

      const request = queryRequest.params[0];
      return {
        ...queryRequest,
        params: [
          {
            ...request,
            filter: {
              ...request.filter,
              ...(fromFactoryId === undefined
                ? {}
                : { from: resolveFactory(fromFactoryId) }),
              ...(toFactoryId === undefined
                ? {}
                : { to: resolveFactory(toFactoryId) }),
            },
          },
        ],
      };
    }
    case "eth_queryTraces": {
      const fromFactoryId = queryRequest.factories.from;
      const toFactoryId = queryRequest.factories.to;
      if (fromFactoryId === undefined && toFactoryId === undefined) {
        return queryRequest;
      }

      const request = queryRequest.params[0];
      return {
        ...queryRequest,
        params: [
          {
            ...request,
            filter: {
              ...request.filter,
              ...(fromFactoryId === undefined
                ? {}
                : { from: resolveFactory(fromFactoryId) }),
              ...(toFactoryId === undefined
                ? {}
                : { to: resolveFactory(toFactoryId) }),
            },
          },
        ],
      };
    }
    case "eth_queryTransfers": {
      const fromFactoryId = queryRequest.factories.from;
      const toFactoryId = queryRequest.factories.to;
      if (fromFactoryId === undefined && toFactoryId === undefined) {
        return queryRequest;
      }

      const request = queryRequest.params[0];
      return {
        ...queryRequest,
        params: [
          {
            ...request,
            filter: {
              ...request.filter,
              ...(fromFactoryId === undefined
                ? {}
                : { from: resolveFactory(fromFactoryId) }),
              ...(toFactoryId === undefined
                ? {}
                : { to: resolveFactory(toFactoryId) }),
            },
          },
        ],
      };
    }
  }
};

async function* paginateQueryRequest<
  method extends
    | "eth_queryBlocks"
    | "eth_queryTransactions"
    | "eth_queryTraces"
    | "eth_queryLogs"
    | "eth_queryTransfers",
  params extends {
    eth_queryBlocks: QueryBlocksRequest<Hex, Hex>;
    eth_queryTransactions: QueryTransactionsRequest<Hex, Hex>;
    eth_queryTraces: QueryTracesRequest<Hex, Hex>;
    eth_queryLogs: QueryLogsRequest<Hex, Hex>;
    eth_queryTransfers: QueryTransfersRequest<Hex, Hex>;
  }[method],
>(
  rpc: Rpc,
  method: method,
  params: params,
  context?: Parameters<Rpc["request"]>[1],
): AsyncGenerator<{
  response: RequestReturnType<method>;
  endClock: ReturnType<typeof startClock>;
}> {
  while (true) {
    const endClock = startClock();
    let response: RequestReturnType<method> = undefined!;

    switch (method) {
      case "eth_queryBlocks":
        response = (await eth_queryBlocks(
          rpc,
          [params as QueryBlocksRequest<Hex, Hex>],
          context,
        )) as RequestReturnType<method>;
        break;
      case "eth_queryTransactions":
        response = (await eth_queryTransactions(
          rpc,
          [params as QueryTransactionsRequest<Hex, Hex>],
          context,
        )) as RequestReturnType<method>;
        break;
      case "eth_queryTraces":
        response = (await eth_queryTraces(
          rpc,
          [params as QueryTracesRequest<Hex, Hex>],
          context,
        )) as RequestReturnType<method>;
        break;
      case "eth_queryLogs":
        response = (await eth_queryLogs(
          rpc,
          [params as QueryLogsRequest<Hex, Hex>],
          context,
        )) as RequestReturnType<method>;
        break;
      case "eth_queryTransfers":
        response = (await eth_queryTransfers(
          rpc,
          [params as QueryTransfersRequest<Hex, Hex>],
          context,
        )) as RequestReturnType<method>;
        break;
      default:
        never(method);
    }

    yield { response, endClock };

    if (isLastPage(response)) break;
    updateRequestPagination(params, response);
  }
}
