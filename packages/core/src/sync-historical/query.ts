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
import type { RequestReturnType, Rpc } from "@/rpc/index.js";
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
import { drainAsyncGenerator } from "@/utils/generators.js";
import { type Interval, intervalBounds } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";

export type QueryHistoricalSync = {
  /**
   * Sync block data for an interval.
   * @returns Closest-to-tip synced block.
   */
  syncIntervalBlockData(params: {
    interval: Interval;
    requiredIntervals: IntervalWithFilter[];
    requiredFactoryIntervals: IntervalWithFactory[];
    syncStore: SyncStore;
  }): Promise<SyncBlockHeader | undefined>;
};

type CreateQueryHistoricalSyncParams = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  childAddresses: Map<string, Map<Address, number>>;
};

type QueryRequestWithFilter<request extends { filter?: object }> = Omit<
  request,
  "filter"
> & {
  filter: NonNullable<request["filter"]>;
};

type RpcQueryBlocksRequest = QueryBlocksRequest<Hex, Hex>;
type RpcQueryTransactionsRequest = QueryTransactionsRequest<Hex, Hex>;
type RpcQueryLogsRequest = QueryLogsRequest<Hex, Hex>;
type RpcQueryTracesRequest = QueryTracesRequest<Hex, Hex>;
type RpcQueryTransfersRequest = QueryTransfersRequest<Hex, Hex>;

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

export const createQueryHistoricalSync = (
  params: CreateQueryHistoricalSyncParams,
): QueryHistoricalSync => {
  const getQueryRequestAddress = (
    value: Address | Address[] | Factory | undefined,
    childAddresses: Map<string, Map<Address, number>>,
  ) => {
    if (isAddressFactory(value)) {
      const factoryChildAddresses = childAddresses.get(value.id)!;
      if (
        factoryChildAddresses.size >
        params.common.options.factoryAddressCountThreshold
      ) {
        return undefined;
      }
      return Array.from(factoryChildAddresses.keys());
    }

    return value;
  };

  return {
    async syncIntervalBlockData({
      requiredIntervals,
      requiredFactoryIntervals,
      syncStore,
    }) {
      const context = {
        logger: params.common.logger.child({ action: "fetch_block_data" }),
      };

      const factoryIntervalsById: Map<
        Factory["id"],
        { factory: Factory; interval: Interval }
      > = new Map();

      for (const { factory, interval } of requiredFactoryIntervals) {
        if (factoryIntervalsById.has(factory.id)) {
          const existingInterval = factoryIntervalsById.get(
            factory.id,
          )!.interval;

          factoryIntervalsById.get(factory.id)!.interval = intervalBounds([
            existingInterval,
            interval,
          ]);
        } else {
          factoryIntervalsById.set(factory.id, { factory, interval });
        }
      }

      requiredFactoryIntervals = Array.from(factoryIntervalsById.values());
      const childAddressesByFactoryId: ChildAddresses = new Map();

      for (const {
        factory,
        interval: filterInterval,
      } of requiredFactoryIntervals) {
        const factoryLogRequestParams = {
          fromBlock: numberToHex(filterInterval[0]),
          toBlock: numberToHex(filterInterval[1]),
          filter: {
            address: factory.address,
            topics: [factory.eventSelector],
          },
          fields: { logs: true }, // TODO(kyle) column selection: blockNumber, logIndex, address
        } as const satisfies QueryRequestWithFilter<RpcQueryLogsRequest>;

        const factoryResponse = await drainAsyncGenerator(
          paginateQueryRequest(
            params.rpc,
            "eth_queryLogs",
            factoryLogRequestParams,
            context,
          ),
        );

        const childAddresses = new Map<Address, number>();
        const factoryChildAddresses = params.childAddresses.get(factory.id)!;
        childAddressesByFactoryId.set(factory.id, childAddresses);

        const childAddressDecodeFailureIds = new Set<string>();
        let childAddressDecodeFailureCount = 0;
        let childAddressDecodeSuccessCount = 0;

        for (const response of factoryResponse) {
          for (const queryLog of response.data.logs) {
            const log = queryLogToSyncLog(queryLog);
            if (isLogFactoryMatched({ factory, log })) {
              let address: Address;
              try {
                address = getChildAddress({ log, factory });
                childAddressDecodeSuccessCount++;
              } catch (error) {
                if (factory.address === undefined) {
                  childAddressDecodeFailureCount++;
                  if (childAddressDecodeFailureIds.has(factory.id) === false) {
                    childAddressDecodeFailureIds.add(factory.id);
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
                  }
                  continue;
                } else {
                  throw error;
                }
              }
              const existingBlockNumber = factoryChildAddresses.get(address);
              const newBlockNumber = hexToNumber(log.blockNumber);

              if (
                existingBlockNumber === undefined ||
                existingBlockNumber > newBlockNumber
              ) {
                childAddresses.set(address, newBlockNumber);
                factoryChildAddresses.set(address, newBlockNumber);
              }
            }
          }
        }

        if (childAddressDecodeFailureCount > 0) {
          params.common.logger.debug({
            msg: "Logs matched by factory contained child addresses that could not be extracted",
            failure_count: childAddressDecodeFailureCount,
            success_count: childAddressDecodeSuccessCount,
          });
        }

        childAddressesByFactoryId.set(factory.id, childAddresses);
      }

      await promiseAllSettledWithThrow(
        Array.from(childAddressesByFactoryId.entries()).map(
          ([factoryId, childAddresses]) =>
            syncStore.insertChildAddresses(
              {
                factory: factoryIntervalsById.get(factoryId)!.factory,
                childAddresses,
                chainId: params.chain.id,
              },
              context,
            ),
        ),
      );

      const queryFilterKeys = {
        eth_queryTransactions: ["from", "to"],
        eth_queryTraces: ["from", "to", "selector"],
        eth_queryTransfers: ["from", "to"],
      } as const;

      const blockRequestParams: RpcQueryBlocksRequest[] = [];
      const transactionRequestParams: QueryRequestWithFilter<RpcQueryTransactionsRequest>[] =
        [];
      const traceRequestParams: QueryRequestWithFilter<RpcQueryTracesRequest>[] =
        [];
      const logRequestParams: QueryRequestWithFilter<RpcQueryLogsRequest>[] =
        [];
      const transferRequestParams: QueryRequestWithFilter<RpcQueryTransfersRequest>[] =
        [];

      for (const { filter, interval: filterInterval } of requiredIntervals) {
        const range = {
          fromBlock: numberToHex(filterInterval[0]),
          toBlock: numberToHex(filterInterval[1]),
        };

        switch (filter.type) {
          case "block": {
            blockRequestParams.push({
              ...range,
              fields: { blocks: true },
            });
            break;
          }
          case "transaction": {
            const transactionRequestFilter = {
              from: getQueryRequestAddress(
                filter.fromAddress,
                params.childAddresses,
              ),
              to: getQueryRequestAddress(
                filter.toAddress,
                params.childAddresses,
              ),
            };

            let isMerged = false;
            for (const mergedRequest of transactionRequestParams) {
              let filterDiffCount = 0;

              if (
                JSON.stringify(transactionRequestFilter.from) !==
                JSON.stringify(mergedRequest.filter.from)
              ) {
                filterDiffCount += 1;
              }

              if (
                JSON.stringify(transactionRequestFilter.to) !==
                JSON.stringify(mergedRequest.filter.to)
              ) {
                filterDiffCount += 1;
              }

              if (filterDiffCount <= 1) {
                for (const key of queryFilterKeys.eth_queryTransactions) {
                  const left = mergedRequest.filter[key];
                  const right = transactionRequestFilter[key];
                  if (JSON.stringify(left) === JSON.stringify(right)) continue;

                  mergedRequest.filter[key] = mergeFilterValue(left, right);
                }

                const mergedInterval = intervalBounds([
                  [
                    Number(mergedRequest.fromBlock),
                    Number(mergedRequest.toBlock),
                  ],
                  filterInterval,
                ]);
                mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
                mergedRequest.toBlock = numberToHex(mergedInterval[1]);

                isMerged = true;
                break;
              }
            }

            if (isMerged === false) {
              transactionRequestParams.push({
                ...range,
                filter: transactionRequestFilter,
                fields: { blocks: true, transactions: true },
              });
            }

            break;
          }
          case "log": {
            const topics = [
              filter.topic0,
              filter.topic1,
              filter.topic2,
              filter.topic3,
            ];

            // Note: the `topics` field is very fragile for many rpc providers, and
            // cannot handle extra "null" topics

            if (topics[3] === null) {
              topics.pop();
              if (topics[2] === null) {
                topics.pop();
                if (topics[1] === null) {
                  topics.pop();
                  if (topics[0] === null) {
                    topics.pop();
                  }
                }
              }
            }

            const logRequestFilter = {
              address: getQueryRequestAddress(
                filter.address,
                params.childAddresses,
              ),
              topics,
            };

            let isMerged = false;
            for (const mergedRequest of logRequestParams) {
              const numberFilterDiff =
                Number(
                  JSON.stringify(mergedRequest.filter.address) !==
                    JSON.stringify(logRequestFilter.address),
                ) +
                [0, 1, 2, 3].filter(
                  (index) =>
                    JSON.stringify(
                      mergedRequest.filter.topics?.[index] ?? null,
                    ) !==
                    JSON.stringify(logRequestFilter.topics[index] ?? null),
                ).length;
              if (numberFilterDiff > 1) continue;

              if (
                JSON.stringify(mergedRequest.filter.address) !==
                JSON.stringify(logRequestFilter.address)
              ) {
                mergedRequest.filter.address = mergeFilterValue(
                  mergedRequest.filter.address,
                  logRequestFilter.address,
                );
              }

              const mergedTopics = [...(mergedRequest.filter.topics ?? [])];
              for (const index of [0, 1, 2, 3]) {
                const left = mergedTopics[index] ?? null;
                const right = logRequestFilter.topics[index] ?? null;
                if (JSON.stringify(left) === JSON.stringify(right)) continue;

                mergedTopics[index] =
                  mergeFilterValue(left ?? undefined, right ?? undefined) ??
                  null;
              }
              while (mergedTopics.at(-1) === null) mergedTopics.pop();
              mergedRequest.filter.topics = mergedTopics;

              const mergedInterval = intervalBounds([
                [
                  Number(mergedRequest.fromBlock),
                  Number(mergedRequest.toBlock),
                ],
                filterInterval,
              ]);
              mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
              mergedRequest.toBlock = numberToHex(mergedInterval[1]);
              isMerged = true;
              break;
            }

            if (isMerged === false) {
              logRequestParams.push({
                ...range,
                filter: logRequestFilter,
                fields: { blocks: true, transactions: true, logs: true },
              });
            }
            break;
          }
          case "trace": {
            const traceRequestFilter = {
              from: getQueryRequestAddress(
                filter.fromAddress,
                params.childAddresses,
              ),
              to: getQueryRequestAddress(
                filter.toAddress,
                params.childAddresses,
              ),
              selector: filter.functionSelector,
            };

            let isMerged = false;
            for (const mergedRequest of traceRequestParams) {
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
                [
                  Number(mergedRequest.fromBlock),
                  Number(mergedRequest.toBlock),
                ],
                filterInterval,
              ]);
              mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
              mergedRequest.toBlock = numberToHex(mergedInterval[1]);
              isMerged = true;
              break;
            }

            if (isMerged === false) {
              traceRequestParams.push({
                ...range,
                filter: traceRequestFilter,
                fields: { blocks: true, transactions: true, traces: true },
              });
            }
            break;
          }
          case "transfer": {
            const transferRequestFilter = {
              from: getQueryRequestAddress(
                filter.fromAddress,
                params.childAddresses,
              ),
              to: getQueryRequestAddress(
                filter.toAddress,
                params.childAddresses,
              ),
            };

            let isMerged = false;
            for (const mergedRequest of transferRequestParams) {
              const numberFilterDiff =
                queryFilterKeys.eth_queryTransfers.filter(
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
                [
                  Number(mergedRequest.fromBlock),
                  Number(mergedRequest.toBlock),
                ],
                filterInterval,
              ]);
              mergedRequest.fromBlock = numberToHex(mergedInterval[0]);
              mergedRequest.toBlock = numberToHex(mergedInterval[1]);
              isMerged = true;
              break;
            }

            if (isMerged === false) {
              transferRequestParams.push({
                ...range,
                filter: transferRequestFilter,
                fields: { blocks: true, transactions: true, transfers: true },
              });
            }
            break;
          }
        }
      }

      // TODO(kyle) chunk large address arrays into multiple requests

      const [
        blockResponses,
        transactionResponses,
        logResponses,
        traceResponses,
        transferResponses,
      ] = await Promise.all([
        Promise.all(
          blockRequestParams.map((request) =>
            drainAsyncGenerator(
              paginateQueryRequest(
                params.rpc,
                "eth_queryBlocks",
                request,
                context,
              ),
            ),
          ),
        ).then((responses) => responses.flat()),
        Promise.all(
          transactionRequestParams.map((request) =>
            drainAsyncGenerator(
              paginateQueryRequest(
                params.rpc,
                "eth_queryTransactions",
                request,
                context,
              ),
            ),
          ),
        ).then((responses) => responses.flat()),
        Promise.all(
          logRequestParams.map((request) =>
            drainAsyncGenerator(
              paginateQueryRequest(
                params.rpc,
                "eth_queryLogs",
                request,
                context,
              ),
            ),
          ),
        ).then((responses) => responses.flat()),
        Promise.all(
          traceRequestParams.map((request) =>
            drainAsyncGenerator(
              paginateQueryRequest(
                params.rpc,
                "eth_queryTraces",
                request,
                context,
              ),
            ),
          ),
        ).then((responses) => responses.flat()),
        Promise.all(
          transferRequestParams.map((request) =>
            drainAsyncGenerator(
              paginateQueryRequest(
                params.rpc,
                "eth_queryTransfers",
                request,
                context,
              ),
            ),
          ),
        ).then((responses) => responses.flat()),
      ]);

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

      let closestToTipBlock: SyncBlockHeader | undefined;
      const updateClosestToTipBlock = (blocks: Iterable<SyncBlockHeader>) => {
        for (const block of blocks) {
          if (
            closestToTipBlock === undefined ||
            Number(block.number) > Number(closestToTipBlock.number)
          ) {
            closestToTipBlock = block;
          }
        }
      };

      const insertedBlocks = new Set<Hex>();
      const insertedTransactions = new Set<`${Hex}_${Hex}`>();
      const insertedTransactionReceipts = new Set<`${Hex}_${Hex}`>();
      const insertedTraces = new Set<`${Hex}_${Hex}_${number}`>();
      const insertedLogs = new Set<`${Hex}_${Hex}`>();

      for (const response of blockResponses) {
        const blocks: SyncBlockHeader[] = [];

        for (const queryBlock of response.data.blocks) {
          const block = queryBlockToSyncBlockHeader(queryBlock);
          for (const { filter } of requiredIntervals) {
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
          if (insertedBlocks.has(block.number)) {
            return false;
          }

          insertedBlocks.add(block.number);

          return true;
        });

        updateClosestToTipBlock(blocksToInsert);

        await syncStore.insertBlocks(
          { blocks: blocksToInsert, chainId: params.chain.id },
          context,
        );
      }

      for (const response of transactionResponses) {
        const transactions: SyncTransaction[] = [];
        const transactionReceipts: SyncTransactionReceipt[] = [];

        const blocks = response.data.blocks!.map(queryBlockToSyncBlockHeader);

        for (const queryTransaction of response.data.transactions) {
          const transaction =
            queryTransactionToSyncTransaction(queryTransaction);

          for (const { filter } of requiredIntervals) {
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
                queryTransactionToSyncTransactionReceipt(queryTransaction),
              );

              break;
            }
          }
        }

        const transactionsToInsert = transactions.filter((transaction) => {
          const key =
            `${transaction.blockNumber}_${transaction.transactionIndex}` as const;

          if (insertedTransactions.has(key)) {
            return false;
          }

          insertedTransactions.add(key);

          return true;
        });
        const transactionReceiptsToInsert = transactionReceipts.filter(
          (transaction) => {
            const key =
              `${transaction.blockNumber}_${transaction.transactionIndex}` as const;

            if (insertedTransactionReceipts.has(key)) {
              return false;
            }

            insertedTransactionReceipts.add(key);

            return true;
          },
        );

        const blocksToInsert = blocks.filter((block) => {
          if (insertedBlocks.has(block.number)) {
            return false;
          }

          insertedBlocks.add(block.number);

          return true;
        });

        updateClosestToTipBlock(blocksToInsert);

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
      }

      for (const response of logResponses) {
        const logs: SyncLog[] = [];

        const blocks = response.data.blocks!.map(queryBlockToSyncBlockHeader);
        const transactions = response.data.transactions!.map(
          queryTransactionToSyncTransaction,
        );
        const transactionReceipts = response.data.transactions!.map(
          queryTransactionToSyncTransactionReceipt,
        );

        for (const queryLog of response.data.logs) {
          const log = queryLogToSyncLog(queryLog);

          for (const { filter } of requiredIntervals) {
            const blockNumber = Number(log.blockNumber);
            if (
              filter.type === "log" &&
              isLogFilterMatched({ filter, log }) &&
              factoryAddressMatches(filter.address, log.address, blockNumber)
            ) {
              logs.push(log);

              break;
            }
          }
        }

        const blocksToInsert = blocks.filter((block) => {
          if (insertedBlocks.has(block.number)) {
            return false;
          }

          insertedBlocks.add(block.number);

          return true;
        });
        const transactionsToInsert = transactions.filter((transaction) => {
          const key =
            `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
          if (insertedTransactions.has(key)) {
            return false;
          }

          insertedTransactions.add(key);

          return true;
        });
        const transactionReceiptsToInsert = transactionReceipts.filter(
          (transactionReceipt) => {
            const key =
              `${transactionReceipt.blockNumber}_${transactionReceipt.transactionIndex}` as const;
            if (insertedTransactionReceipts.has(key)) {
              return false;
            }

            insertedTransactionReceipts.add(key);

            return true;
          },
        );
        const logsToInsert = logs.filter((log) => {
          const key = `${log.blockNumber}_${log.logIndex}` as const;
          if (insertedLogs.has(key)) {
            return false;
          }

          insertedLogs.add(key);

          return true;
        });

        updateClosestToTipBlock(blocksToInsert);

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
      }

      for (const response of traceResponses) {
        const traces: SyncTrace[] = [];

        const blocks = response.data.blocks!.map(queryBlockToSyncBlockHeader);
        const transactions = response.data.transactions!.map(
          queryTransactionToSyncTransaction,
        );
        const transactionReceipts = response.data.transactions!.map(
          queryTransactionToSyncTransactionReceipt,
        );
        const transactionsByHash = new Map<Hex, SyncTransaction>();
        const blocksByNumber = new Map<Hex, SyncBlockHeader>();

        for (const block of blocks) {
          blocksByNumber.set(block.number, block);
        }
        for (const transaction of transactions) {
          transactionsByHash.set(transaction.hash, transaction);
        }

        const sortedTraces = response.data.traces.sort((a, b) =>
          String(a.traceAddress) > String(b.traceAddress) ? 1 : -1,
        );

        for (const [index, queryTrace] of sortedTraces.entries()) {
          const trace = queryTraceToSyncTrace(queryTrace, index);
          const transaction = transactionsByHash.get(trace.transactionHash)!;
          const block = blocksByNumber.get(transaction.blockNumber)!;

          for (const { filter } of requiredIntervals) {
            const blockNumber = Number(block.number);
            if (
              filter.type === "trace" &&
              isTraceFilterMatched({ filter, trace: trace.trace, block }) &&
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
              traces.push(trace);

              break;
            }
          }
        }

        const blocksToInsert = blocks.filter((block) => {
          if (insertedBlocks.has(block.number)) {
            return false;
          }

          insertedBlocks.add(block.number);

          return true;
        });
        const transactionsToInsert = transactions.filter((transaction) => {
          const key =
            `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
          if (insertedTransactions.has(key)) {
            return false;
          }

          insertedTransactions.add(key);

          return true;
        });
        const transactionReceiptsToInsert = transactionReceipts.filter(
          (transactionReceipt) => {
            const key =
              `${transactionReceipt.blockNumber}_${transactionReceipt.transactionIndex}` as const;
            if (insertedTransactionReceipts.has(key)) {
              return false;
            }

            insertedTransactionReceipts.add(key);

            return true;
          },
        );
        const tracesToInsert = traces
          .map((trace) => {
            const transaction = transactionsByHash.get(trace.transactionHash)!;
            const block = blocksByNumber.get(transaction.blockNumber)!;

            return { trace, block, transaction };
          })
          .filter(({ trace, transaction }) => {
            const key =
              `${transaction.blockNumber}_${transaction.transactionIndex}_${trace.trace.index}` as const;
            if (insertedTraces.has(key)) {
              return false;
            }

            insertedTraces.add(key);

            return true;
          });

        updateClosestToTipBlock(blocksToInsert);
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
            {
              traces: tracesToInsert,
              chainId: params.chain.id,
            },
            context,
          ),
        ]);
      }

      for (const response of transferResponses) {
        const traces: SyncTrace[] = [];

        const blocks = response.data.blocks!.map(queryBlockToSyncBlockHeader);
        const transactions = response.data.transactions!.map(
          queryTransactionToSyncTransaction,
        );
        const transactionReceipts = response.data.transactions!.map(
          queryTransactionToSyncTransactionReceipt,
        );
        const transactionsByHash = new Map<Hex, SyncTransaction>();
        const blocksByNumber = new Map<Hex, SyncBlockHeader>();

        for (const block of blocks) {
          blocksByNumber.set(block.number, block);
        }
        for (const transaction of transactions) {
          transactionsByHash.set(transaction.hash, transaction);
        }

        const sortedTransfers = response.data.transfers.sort((a, b) =>
          String(a.traceAddress) > String(b.traceAddress) ? 1 : -1,
        );

        for (const [index, queryTransfer] of sortedTransfers.entries()) {
          const trace = queryTraceToSyncTrace(queryTransfer, index);
          const transaction = transactionsByHash.get(trace.transactionHash)!;
          const block = blocksByNumber.get(transaction.blockNumber)!;

          for (const { filter } of requiredIntervals) {
            const blockNumber = Number(block.number);
            if (
              filter.type === "transfer" &&
              isTransferFilterMatched({ filter, trace: trace.trace, block }) &&
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
              traces.push(trace);

              break;
            }
          }
        }

        const blocksToInsert = blocks.filter((block) => {
          if (insertedBlocks.has(block.number)) {
            return false;
          }

          insertedBlocks.add(block.number);

          return true;
        });
        const transactionsToInsert = transactions.filter((transaction) => {
          const key =
            `${transaction.blockNumber}_${transaction.transactionIndex}` as const;
          if (insertedTransactions.has(key)) {
            return false;
          }

          insertedTransactions.add(key);

          return true;
        });
        const transactionReceiptsToInsert = transactionReceipts.filter(
          (transactionReceipt) => {
            const key =
              `${transactionReceipt.blockNumber}_${transactionReceipt.transactionIndex}` as const;
            if (insertedTransactionReceipts.has(key)) {
              return false;
            }

            insertedTransactionReceipts.add(key);

            return true;
          },
        );
        const tracesToInsert = traces
          .map((trace) => {
            const transaction = transactionsByHash.get(trace.transactionHash)!;
            const block = blocksByNumber.get(transaction.blockNumber)!;

            return { trace, block, transaction };
          })
          .filter(({ trace, transaction }) => {
            const key =
              `${transaction.blockNumber}_${transaction.transactionIndex}_${trace.trace.index}` as const;
            if (insertedTraces.has(key)) {
              return false;
            }

            insertedTraces.add(key);

            return true;
          });

        updateClosestToTipBlock(blocksToInsert);
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
            {
              traces: tracesToInsert,
              chainId: params.chain.id,
            },
            context,
          ),
        ]);
      }

      return closestToTipBlock;
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

  return {
    transactionHash,
    trace: syncTrace,
  };
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
): AsyncGenerator<RequestReturnType<method>> {
  while (true) {
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

    yield response;

    if (isLastPage(response)) break;
    updateRequestPagination(params, response);
  }
}
