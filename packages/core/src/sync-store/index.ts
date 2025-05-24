import crypto from "node:crypto";
import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Factory,
  Filter,
  FilterWithoutBlocks,
  Fragment,
  FragmentId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LightBlock,
  LogFilter,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "@/sync/filter.js";
import { encodeFragment, getFragments } from "@/sync/fragments.js";
import type { Interval } from "@/utils/interval.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import {
  type SQL,
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { type PgColumn, unionAll } from "drizzle-orm/pg-core";
import {
  type Address,
  type EIP1193Parameters,
  checksumAddress,
  hexToNumber,
} from "viem";
import {
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encode.js";
import * as ponderSyncSchema from "./schema.js";

export type SyncStore = {
  insertIntervals(args: {
    intervals: { filter: FilterWithoutBlocks; interval: Interval }[];
    chainId: number;
  }): Promise<void>;
  getIntervals(args: { filters: Filter[] }): Promise<
    Map<Filter, { fragment: Fragment; intervals: Interval[] }[]>
  >;
  insertChildAddresses(args: {
    factory: Factory;
    childAddresses: Map<Address, number>;
    chainId: number;
  }): Promise<void>;
  getChildAddresses(args: { factory: Factory }): Promise<Map<Address, number>>;
  insertLogs(args: { logs: SyncLog[]; chainId: number }): Promise<void>;
  insertBlocks(args: { blocks: SyncBlock[]; chainId: number }): Promise<void>;
  insertTransactions(args: {
    transactions: SyncTransaction[];
    chainId: number;
  }): Promise<void>;
  insertTransactionReceipts(args: {
    transactionReceipts: SyncTransactionReceipt[];
    chainId: number;
  }): Promise<void>;
  insertTraces(args: {
    traces: {
      trace: SyncTrace;
      block: SyncBlock;
      transaction: SyncTransaction;
    }[];
    chainId: number;
  }): Promise<void>;
  getEventBlockData(args: {
    filters: Filter[];
    fromBlock: number;
    toBlock: number;
    chainId: number;
    limit: number;
  }): Promise<{
    blockData: {
      block: InternalBlock;
      logs: InternalLog[];
      transactions: InternalTransaction[];
      transactionReceipts: InternalTransactionReceipt[];
      traces: InternalTrace[];
    }[];
    cursor: number;
  }>;
  insertRpcRequestResults(args: {
    requests: {
      request: EIP1193Parameters;
      blockNumber: number | undefined;
      result: string;
    }[];
    chainId: number;
  }): Promise<void>;
  getRpcRequestResults(args: {
    requests: EIP1193Parameters[];
    chainId: number;
  }): Promise<(string | undefined)[]>;
  pruneRpcRequestResults(args: {
    blocks: Pick<LightBlock, "number">[];
    chainId: number;
  }): Promise<void>;
  pruneByChain(args: { chainId: number }): Promise<void>;
};

export const createSyncStore = ({
  common,
  database,
}: { common: Common; database: Database }): SyncStore => ({
  insertIntervals: async ({ intervals, chainId }) => {
    if (intervals.length === 0) return;

    await database.wrap(
      { method: "insertIntervals", includeTraceLogs: true },
      async () => {
        const perFragmentIntervals = new Map<FragmentId, Interval[]>();
        const values: (typeof ponderSyncSchema.intervals.$inferInsert)[] = [];

        // dedupe and merge matching fragments

        for (const { filter, interval } of intervals) {
          for (const fragment of getFragments(filter)) {
            const fragmentId = encodeFragment(fragment.fragment);
            if (perFragmentIntervals.has(fragmentId) === false) {
              perFragmentIntervals.set(fragmentId, []);
            }

            perFragmentIntervals.get(fragmentId)!.push(interval);
          }
        }

        // NOTE: In order to force proper range union behavior, `interval[1]` must
        // be rounded up.

        for (const [fragmentId, intervals] of perFragmentIntervals) {
          const numranges = intervals
            .map((interval) => {
              const start = interval[0];
              const end = interval[1] + 1;
              return `numrange(${start}, ${end}, '[]')`;
            })
            .join(", ");

          values.push({
            fragmentId: fragmentId,
            chainId: BigInt(chainId),
            // @ts-expect-error
            blocks: sql.raw(`nummultirange(${numranges})`),
          });
        }

        await database.qb.sync
          .insert(ponderSyncSchema.intervals)
          .values(values)
          .onConflictDoUpdate({
            target: ponderSyncSchema.intervals.fragmentId,
            set: {
              blocks: sql`intervals.blocks + excluded.blocks`,
            },
          });
      },
    );
  },
  getIntervals: async ({ filters }) =>
    database.wrap(
      { method: "getIntervals", includeTraceLogs: true },
      async () => {
        const queries = filters.flatMap((filter, i) => {
          const fragments = getFragments(filter);
          return fragments.map((fragment, j) =>
            database.qb.sync
              .select({
                mergedBlocks: sql<string>`range_agg(unnested.blocks)`.as(
                  "merged_blocks",
                ),
                filter: sql.raw(`'${i}'`).as("filter"),
                fragment: sql.raw(`'${j}'`).as("fragment"),
              })
              .from(
                database.qb.sync
                  .select({ blocks: sql.raw("unnest(blocks)").as("blocks") })
                  .from(ponderSyncSchema.intervals)
                  .where(
                    inArray(
                      ponderSyncSchema.intervals.fragmentId,
                      fragment.adjacentIds,
                    ),
                  )
                  .as("unnested"),
              ),
          );
        });

        let rows: Awaited<(typeof queries)[number]>;

        if (queries.length > 1) {
          // @ts-expect-error
          rows = await unionAll(...queries);
        } else {
          rows = await queries[0]!.execute();
        }

        const result = new Map<
          Filter,
          { fragment: Fragment; intervals: Interval[] }[]
        >();

        // NOTE: `interval[1]` must be rounded down in order to offset the previous
        // rounding.

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i]!;
          const fragments = getFragments(filter);
          result.set(filter, []);
          for (let j = 0; j < fragments.length; j++) {
            const fragment = fragments[j]!;
            const intervals = rows
              .filter((row) => row.filter === `${i}`)
              .filter((row) => row.fragment === `${j}`)
              .map((row) =>
                (row.mergedBlocks
                  ? (JSON.parse(
                      `[${row.mergedBlocks.slice(1, -1)}]`,
                    ) as Interval[])
                  : []
                ).map((interval) => [interval[0], interval[1] - 1] as Interval),
              )[0]!;

            result
              .get(filter)!
              .push({ fragment: fragment.fragment, intervals });
          }
        }

        return result;
      },
    ),
  insertChildAddresses: async ({ factory, childAddresses, chainId }) => {
    if (childAddresses.size === 0) return;
    await database.wrap(
      { method: "insertChildAddresses", includeTraceLogs: true },
      async () => {
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters / 3,
        );

        const values: (typeof ponderSyncSchema.factoryAddresses.$inferInsert)[] =
          [];

        const factoryInsert = database.qb.sync.$with("factory_insert").as(
          database.qb.sync
            .insert(ponderSyncSchema.factories)
            .values({ factory })
            // @ts-expect-error bug with drizzle-orm
            .returning({ id: ponderSyncSchema.factories.id })
            .onConflictDoUpdate({
              target: ponderSyncSchema.factories.factory,
              set: { factory: sql`excluded.factory` },
            }),
        );

        for (const [address, blockNumber] of childAddresses) {
          values.push({
            // @ts-expect-error
            factoryId: sql`(SELECT id FROM factory_insert)`,
            chainId: BigInt(chainId),
            blockNumber: BigInt(blockNumber),
            address,
          });
        }

        for (let i = 0; i < values.length; i += batchSize) {
          await database.qb.sync
            .with(factoryInsert)
            .insert(ponderSyncSchema.factoryAddresses)
            .values(values.slice(i, i + batchSize));
        }
      },
    );
  },
  getChildAddresses: ({ factory }) =>
    database.wrap(
      { method: "getChildAddresses", includeTraceLogs: true },
      () => {
        const factoryInsert = database.qb.sync.$with("factory_insert").as(
          database.qb.sync
            .insert(ponderSyncSchema.factories)
            .values({ factory })
            // @ts-expect-error bug with drizzle-orm
            .returning({ id: ponderSyncSchema.factories.id })
            .onConflictDoUpdate({
              target: ponderSyncSchema.factories.factory,
              set: { factory: sql`excluded.factory` },
            }),
        );

        return database.qb.sync
          .with(factoryInsert)
          .select({
            address: ponderSyncSchema.factoryAddresses.address,
            blockNumber: ponderSyncSchema.factoryAddresses.blockNumber,
          })
          .from(ponderSyncSchema.factoryAddresses)
          .where(
            eq(
              ponderSyncSchema.factoryAddresses.factoryId,
              database.qb.sync
                .select({ id: factoryInsert.id })
                .from(factoryInsert),
            ),
          )
          .then((rows) => {
            const result = new Map<Address, number>();
            for (const { address, blockNumber } of rows) {
              if (
                result.has(address) === false ||
                result.get(address)! > Number(blockNumber)
              ) {
                result.set(address, Number(blockNumber));
              }
            }
            return result;
          });
      },
    ),
  insertLogs: async ({ logs, chainId }) => {
    if (logs.length === 0) return;
    await database.wrap(
      { method: "insertLogs", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(encodeLog({ log: logs[0]!, chainId })).length,
        );

        // As an optimization, logs that are matched by a factory do
        // not contain a checkpoint, because not corresponding block is
        // fetched (no block.timestamp). However, when a log is matched by
        // both a log filter and a factory, the checkpoint must be included
        // in the db.

        for (let i = 0; i < logs.length; i += batchSize) {
          await database.qb.sync
            .insert(ponderSyncSchema.logs)
            .values(
              logs
                .slice(i, i + batchSize)
                .map((log) => encodeLog({ log, chainId })),
            )
            .onConflictDoNothing({
              target: [
                ponderSyncSchema.logs.chainId,
                ponderSyncSchema.logs.blockNumber,
                ponderSyncSchema.logs.logIndex,
              ],
            });
        }
      },
    );
  },
  insertBlocks: async ({ blocks, chainId }) => {
    if (blocks.length === 0) return;
    await database.wrap(
      { method: "insertBlocks", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(encodeBlock({ block: blocks[0]!, chainId })).length,
        );

        for (let i = 0; i < blocks.length; i += batchSize) {
          await database.qb.sync
            .insert(ponderSyncSchema.blocks)
            .values(
              blocks
                .slice(i, i + batchSize)
                .map((block) => encodeBlock({ block, chainId })),
            )
            .onConflictDoNothing({
              target: [
                ponderSyncSchema.blocks.chainId,
                ponderSyncSchema.blocks.number,
              ],
            });
        }
      },
    );
  },
  insertTransactions: async ({ transactions, chainId }) => {
    if (transactions.length === 0) return;
    await database.wrap(
      { method: "insertTransactions", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(
              encodeTransaction({
                transaction: transactions[0]!,
                chainId,
              }),
            ).length,
        );

        // As an optimization for the migration, transactions inserted before 0.8 do not
        // contain a checkpoint. However, for correctness the checkpoint must be inserted
        // for new transactions (using onConflictDoUpdate).

        for (let i = 0; i < transactions.length; i += batchSize) {
          await database.qb.sync
            .insert(ponderSyncSchema.transactions)
            .values(
              transactions
                .slice(i, i + batchSize)
                .map((transaction) =>
                  encodeTransaction({ transaction, chainId }),
                ),
            )
            .onConflictDoNothing({
              target: [
                ponderSyncSchema.transactions.chainId,
                ponderSyncSchema.transactions.blockNumber,
                ponderSyncSchema.transactions.transactionIndex,
              ],
            });
        }
      },
    );
  },
  insertTransactionReceipts: async ({ transactionReceipts, chainId }) => {
    if (transactionReceipts.length === 0) return;
    await database.wrap(
      { method: "insertTransactionReceipts", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(
              encodeTransactionReceipt({
                transactionReceipt: transactionReceipts[0]!,
                chainId,
              }),
            ).length,
        );

        for (let i = 0; i < transactionReceipts.length; i += batchSize) {
          await database.qb.sync
            .insert(ponderSyncSchema.transactionReceipts)
            .values(
              transactionReceipts
                .slice(i, i + batchSize)
                .map((transactionReceipt) =>
                  encodeTransactionReceipt({
                    transactionReceipt,
                    chainId,
                  }),
                ),
            )
            .onConflictDoNothing({
              target: [
                ponderSyncSchema.transactionReceipts.chainId,
                ponderSyncSchema.transactionReceipts.blockNumber,
                ponderSyncSchema.transactionReceipts.transactionIndex,
              ],
            });
        }
      },
    );
  },
  insertTraces: async ({ traces, chainId }) => {
    if (traces.length === 0) return;
    await database.wrap(
      { method: "insertTraces", includeTraceLogs: true },
      async () => {
        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(
              encodeTrace({
                trace: traces[0]!.trace,
                block: traces[0]!.block,
                transaction: traces[0]!.transaction,
                chainId,
              }),
            ).length,
        );

        for (let i = 0; i < traces.length; i += batchSize) {
          await database.qb.sync
            .insert(ponderSyncSchema.traces)
            .values(
              traces
                .slice(i, i + batchSize)
                .map(({ trace, block, transaction }) =>
                  encodeTrace({ trace, block, transaction, chainId }),
                ),
            )
            .onConflictDoNothing({
              target: [
                ponderSyncSchema.traces.chainId,
                ponderSyncSchema.traces.blockNumber,
                ponderSyncSchema.traces.transactionIndex,
                ponderSyncSchema.traces.traceIndex,
              ],
            });
        }
      },
    );
  },
  getEventBlockData: async ({ filters, fromBlock, toBlock, chainId, limit }) =>
    database.wrap(
      { method: "getEventBlockData", includeTraceLogs: true },
      async () => {
        const logFilters = filters.filter(
          (f): f is LogFilter => f.type === "log",
        );
        const transactionFilters = filters.filter(
          (f): f is TransactionFilter => f.type === "transaction",
        );
        const traceFilters = filters.filter(
          (f): f is TraceFilter => f.type === "trace",
        );
        const transferFilters = filters.filter(
          (f): f is TransferFilter => f.type === "transfer",
        );

        const shouldQueryBlocks = true;
        const shouldQueryLogs = logFilters.length > 0;
        const shouldQueryTraces =
          traceFilters.length > 0 || transferFilters.length > 0;
        const shouldQueryTransactions =
          transactionFilters.length > 0 || shouldQueryLogs || shouldQueryTraces;
        const shouldQueryTransactionReceipts = filters.some(
          shouldGetTransactionReceipt,
        );

        const blocksQuery = database.qb.sync
          .select({
            number: ponderSyncSchema.blocks.number,
            timestamp: ponderSyncSchema.blocks.timestamp,
            hash: ponderSyncSchema.blocks.hash,
            parentHash: ponderSyncSchema.blocks.parentHash,
            logsBloom: ponderSyncSchema.blocks.logsBloom,
            miner: ponderSyncSchema.blocks.miner,
            gasUsed: ponderSyncSchema.blocks.gasUsed,
            gasLimit: ponderSyncSchema.blocks.gasLimit,
            baseFeePerGas: ponderSyncSchema.blocks.baseFeePerGas,
            nonce: ponderSyncSchema.blocks.nonce,
            mixHash: ponderSyncSchema.blocks.mixHash,
            stateRoot: ponderSyncSchema.blocks.stateRoot,
            receiptsRoot: ponderSyncSchema.blocks.receiptsRoot,
            transactionsRoot: ponderSyncSchema.blocks.transactionsRoot,
            sha3Uncles: ponderSyncSchema.blocks.sha3Uncles,
            size: ponderSyncSchema.blocks.size,
            difficulty: ponderSyncSchema.blocks.difficulty,
            totalDifficulty: ponderSyncSchema.blocks.totalDifficulty,
            extraData: ponderSyncSchema.blocks.extraData,
          })
          .from(ponderSyncSchema.blocks)
          .where(
            and(
              eq(ponderSyncSchema.blocks.chainId, BigInt(chainId)),
              gte(ponderSyncSchema.blocks.number, BigInt(fromBlock)),
              lte(ponderSyncSchema.blocks.number, BigInt(toBlock)),
            ),
          )
          .orderBy(asc(ponderSyncSchema.blocks.number))
          .limit(limit);

        const transactionsQuery = database.qb.sync
          .select({
            blockNumber: ponderSyncSchema.transactions.blockNumber,
            transactionIndex: ponderSyncSchema.transactions.transactionIndex,
            hash: ponderSyncSchema.transactions.hash,
            from: ponderSyncSchema.transactions.from,
            to: ponderSyncSchema.transactions.to,
            input: ponderSyncSchema.transactions.input,
            value: ponderSyncSchema.transactions.value,
            nonce: ponderSyncSchema.transactions.nonce,
            r: ponderSyncSchema.transactions.r,
            s: ponderSyncSchema.transactions.s,
            v: ponderSyncSchema.transactions.v,
            type: ponderSyncSchema.transactions.type,
            gas: ponderSyncSchema.transactions.gas,
            gasPrice: ponderSyncSchema.transactions.gasPrice,
            maxFeePerGas: ponderSyncSchema.transactions.maxFeePerGas,
            maxPriorityFeePerGas:
              ponderSyncSchema.transactions.maxPriorityFeePerGas,
            accessList: ponderSyncSchema.transactions.accessList,
          })
          .from(ponderSyncSchema.transactions)
          .where(
            and(
              eq(ponderSyncSchema.transactions.chainId, BigInt(chainId)),
              gte(ponderSyncSchema.transactions.blockNumber, BigInt(fromBlock)),
              lte(ponderSyncSchema.transactions.blockNumber, BigInt(toBlock)),
            ),
          )
          .orderBy(
            asc(ponderSyncSchema.transactions.blockNumber),
            asc(ponderSyncSchema.transactions.transactionIndex),
          )
          .limit(limit);

        const transactionReceiptsQuery = database.qb.sync
          .select({
            blockNumber: ponderSyncSchema.transactionReceipts.blockNumber,
            transactionIndex:
              ponderSyncSchema.transactionReceipts.transactionIndex,
            from: ponderSyncSchema.transactionReceipts.from,
            to: ponderSyncSchema.transactionReceipts.to,
            contractAddress:
              ponderSyncSchema.transactionReceipts.contractAddress,
            logsBloom: ponderSyncSchema.transactionReceipts.logsBloom,
            gasUsed: ponderSyncSchema.transactionReceipts.gasUsed,
            cumulativeGasUsed:
              ponderSyncSchema.transactionReceipts.cumulativeGasUsed,
            effectiveGasPrice:
              ponderSyncSchema.transactionReceipts.effectiveGasPrice,
            status: ponderSyncSchema.transactionReceipts.status,
            type: ponderSyncSchema.transactionReceipts.type,
          })
          .from(ponderSyncSchema.transactionReceipts)
          .where(
            and(
              eq(ponderSyncSchema.transactionReceipts.chainId, BigInt(chainId)),
              gte(
                ponderSyncSchema.transactionReceipts.blockNumber,
                BigInt(fromBlock),
              ),
              lte(
                ponderSyncSchema.transactionReceipts.blockNumber,
                BigInt(toBlock),
              ),
            ),
          )
          .orderBy(
            asc(ponderSyncSchema.transactionReceipts.blockNumber),
            asc(ponderSyncSchema.transactionReceipts.transactionIndex),
          )
          .limit(limit);

        const logsQuery = database.qb.sync
          .select({
            blockNumber: ponderSyncSchema.logs.blockNumber,
            logIndex: ponderSyncSchema.logs.logIndex,
            transactionIndex: ponderSyncSchema.logs.transactionIndex,
            address: ponderSyncSchema.logs.address,
            topic0: ponderSyncSchema.logs.topic0,
            topic1: ponderSyncSchema.logs.topic1,
            topic2: ponderSyncSchema.logs.topic2,
            topic3: ponderSyncSchema.logs.topic3,
            data: ponderSyncSchema.logs.data,
          })
          .from(ponderSyncSchema.logs)
          .where(
            and(
              eq(ponderSyncSchema.logs.chainId, BigInt(chainId)),
              gte(ponderSyncSchema.logs.blockNumber, BigInt(fromBlock)),
              lte(ponderSyncSchema.logs.blockNumber, BigInt(toBlock)),
              or(...logFilters.map((filter) => logFilter(filter))),
            ),
          )
          .orderBy(
            asc(ponderSyncSchema.logs.blockNumber),
            asc(ponderSyncSchema.logs.logIndex),
          )
          .limit(limit);

        const tracesQuery = database.qb.sync
          .select({
            blockNumber: ponderSyncSchema.traces.blockNumber,
            transactionIndex: ponderSyncSchema.traces.transactionIndex,
            traceIndex: ponderSyncSchema.traces.traceIndex,
            from: ponderSyncSchema.traces.from,
            to: ponderSyncSchema.traces.to,
            input: ponderSyncSchema.traces.input,
            output: ponderSyncSchema.traces.output,
            value: ponderSyncSchema.traces.value,
            type: ponderSyncSchema.traces.type,
            gas: ponderSyncSchema.traces.gas,
            gasUsed: ponderSyncSchema.traces.gasUsed,
            error: ponderSyncSchema.traces.error,
            revertReason: ponderSyncSchema.traces.revertReason,
            subcalls: ponderSyncSchema.traces.subcalls,
          })
          .from(ponderSyncSchema.traces)
          .where(
            and(
              eq(ponderSyncSchema.traces.chainId, BigInt(chainId)),
              gte(ponderSyncSchema.traces.blockNumber, BigInt(fromBlock)),
              lte(ponderSyncSchema.traces.blockNumber, BigInt(toBlock)),
              or(
                ...traceFilters.map((filter) => traceFilter(filter)),
                ...transferFilters.map((filter) => transferFilter(filter)),
              ),
            ),
          )
          .orderBy(
            asc(ponderSyncSchema.traces.blockNumber),
            asc(ponderSyncSchema.traces.traceIndex),
          )
          .limit(limit);

        let endClock = startClock();

        const [
          blocksRows,
          transactionsRows,
          transactionReceiptsRows,
          logsRows,
          tracesRows,
        ] = await Promise.all([
          shouldQueryBlocks
            ? blocksQuery.then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_blocks" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryTransactions
            ? transactionsQuery.then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_transactions" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryTransactionReceipts
            ? transactionReceiptsQuery.then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_transaction_receipts" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryLogs
            ? logsQuery.then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_logs" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryTraces
            ? tracesQuery.then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_traces" },
                  endClock(),
                );

                return res;
              })
            : [],
        ]);

        const supremum = Math.min(
          blocksRows.length < limit
            ? Number.POSITIVE_INFINITY
            : Number(blocksRows[blocksRows.length - 1]!.number),
          transactionsRows.length < limit
            ? Number.POSITIVE_INFINITY
            : Number(
                transactionsRows[transactionsRows.length - 1]!.blockNumber,
              ),
          transactionReceiptsRows.length < limit
            ? Number.POSITIVE_INFINITY
            : Number(
                transactionReceiptsRows[transactionReceiptsRows.length - 1]!
                  .blockNumber,
              ),
          logsRows.length < limit
            ? Number.POSITIVE_INFINITY
            : Number(logsRows[logsRows.length - 1]!.blockNumber),
          tracesRows.length < limit
            ? Number.POSITIVE_INFINITY
            : Number(tracesRows[tracesRows.length - 1]!.blockNumber),
        );

        endClock = startClock();

        const blockData: {
          block: InternalBlock;
          logs: InternalLog[];
          transactions: InternalTransaction[];
          transactionReceipts: InternalTransactionReceipt[];
          traces: InternalTrace[];
        }[] = [];
        let transactionIndex = 0;
        let transactionReceiptIndex = 0;
        let traceIndex = 0;
        let logIndex = 0;
        for (const block of blocksRows) {
          if (Number(block.number) > supremum) {
            break;
          }

          const transactions: InternalTransaction[] = [];
          const transactionReceipts: InternalTransactionReceipt[] = [];
          const logs: InternalLog[] = [];
          const traces: InternalTrace[] = [];

          while (
            transactionIndex < transactionsRows.length &&
            transactionsRows[transactionIndex]!.blockNumber === block.number
          ) {
            const transaction = transactionsRows[transactionIndex]!;
            const internalTransaction =
              transaction as unknown as InternalTransaction;

            internalTransaction.blockNumber = Number(transaction.blockNumber);
            internalTransaction.from = checksumAddress(transaction.from);
            if (transaction.to !== null) {
              internalTransaction.to = checksumAddress(transaction.to);
            }

            if (transaction.type === "0x0") {
              internalTransaction.type = "legacy";
              internalTransaction.accessList = undefined;
              internalTransaction.maxFeePerGas = undefined;
              internalTransaction.maxPriorityFeePerGas = undefined;
            } else if (transaction.type === "0x1") {
              internalTransaction.type = "eip2930";
              internalTransaction.accessList = JSON.parse(
                transaction.accessList!,
              );
              internalTransaction.maxFeePerGas = undefined;
              internalTransaction.maxPriorityFeePerGas = undefined;
            } else if (transaction.type === "0x2") {
              internalTransaction.type = "eip1559";
              internalTransaction.gasPrice = undefined;
              internalTransaction.accessList = undefined;
            } else if (transaction.type === "0x7e") {
              internalTransaction.type = "deposit";
              internalTransaction.gasPrice = undefined;
              internalTransaction.accessList = undefined;
            }

            transactions.push(internalTransaction);
            transactionIndex++;
          }

          while (
            transactionReceiptIndex < transactionReceiptsRows.length &&
            transactionReceiptsRows[transactionReceiptIndex]!.blockNumber ===
              block.number
          ) {
            const transactionReceipt =
              transactionReceiptsRows[transactionReceiptIndex]!;

            const internalTransactionReceipt =
              transactionReceipt as unknown as InternalTransactionReceipt;

            internalTransactionReceipt.blockNumber = Number(
              transactionReceipt.blockNumber,
            );
            if (transactionReceipt.contractAddress !== null) {
              internalTransactionReceipt.contractAddress = checksumAddress(
                transactionReceipt.contractAddress,
              );
            }
            internalTransactionReceipt.from = checksumAddress(
              transactionReceipt.from,
            );
            if (transactionReceipt.to !== null) {
              internalTransactionReceipt.to = checksumAddress(
                transactionReceipt.to,
              );
            }
            internalTransactionReceipt.status =
              transactionReceipt.status === "0x1"
                ? "success"
                : transactionReceipt.status === "0x0"
                  ? "reverted"
                  : (transactionReceipt.status as InternalTransactionReceipt["status"]);
            internalTransactionReceipt.type =
              transactionReceipt.type === "0x0"
                ? "legacy"
                : transactionReceipt.type === "0x1"
                  ? "eip2930"
                  : transactionReceipt.type === "0x2"
                    ? "eip1559"
                    : transactionReceipt.type === "0x7e"
                      ? "deposit"
                      : transactionReceipt.type;

            transactionReceipts.push(internalTransactionReceipt);
            transactionReceiptIndex++;
          }

          while (
            logIndex < logsRows.length &&
            logsRows[logIndex]!.blockNumber === block.number
          ) {
            const log = logsRows[logIndex]!;
            const internalLog = log as unknown as InternalLog;

            internalLog.blockNumber = Number(log.blockNumber);
            internalLog.address = checksumAddress(log.address);
            internalLog.removed = false;
            internalLog.topics = [
              // @ts-ignore
              log.topic0,
              log.topic1,
              log.topic2,
              log.topic3,
            ];
            // @ts-ignore
            log.topic0 = undefined;
            // @ts-ignore
            log.topic1 = undefined;
            // @ts-ignore
            log.topic2 = undefined;
            // @ts-ignore
            log.topic3 = undefined;

            logs.push(internalLog);
            logIndex++;
          }

          while (
            traceIndex < tracesRows.length &&
            tracesRows[traceIndex]!.blockNumber === block.number
          ) {
            const trace = tracesRows[traceIndex]!;
            const internalTrace = trace as unknown as InternalTrace;

            internalTrace.blockNumber = Number(trace.blockNumber);

            internalTrace.from = checksumAddress(trace.from);
            if (trace.to !== null) {
              internalTrace.to = checksumAddress(trace.to);
            }

            if (trace.output === null) {
              internalTrace.output = undefined;
            }

            if (trace.error === null) {
              internalTrace.error = undefined;
            }

            if (trace.revertReason === null) {
              internalTrace.revertReason = undefined;
            }

            traces.push(internalTrace);
            traceIndex++;
          }

          block.miner = checksumAddress(block.miner);

          blockData.push({
            block,
            logs,
            transactions,
            traces,
            transactionReceipts,
          });
        }

        common.metrics.ponder_historical_extract_duration.inc(
          { step: "format" },
          endClock(),
        );

        await new Promise(setImmediate);

        let cursor: number;
        if (
          Math.max(
            blocksRows.length,
            transactionsRows.length,
            transactionReceiptsRows.length,
            logsRows.length,
            tracesRows.length,
          ) !== limit
        ) {
          cursor = toBlock;
        } else if (
          blocksRows.length === limit &&
          Math.max(
            transactionsRows.length,
            transactionReceiptsRows.length,
            logsRows.length,
            tracesRows.length,
          ) !== limit
        ) {
          // all events for `supremum` block have been extracted
          cursor = supremum;
        } else {
          // there may be events for `supremum` block that have not been extracted
          blockData.pop();
          cursor = supremum - 1;
        }

        return { blockData, cursor };
      },
    ),
  insertRpcRequestResults: async ({ requests, chainId }) => {
    if (requests.length === 0) return;
    return database.wrap(
      { method: "insertRpcRequestResults", includeTraceLogs: true },
      async () => {
        const values = requests.map(({ request, blockNumber, result }) => ({
          requestHash: crypto
            .createHash("md5")
            .update(toLowerCase(JSON.stringify(orderObject(request))))
            .digest("hex"),
          chainId: BigInt(chainId),
          blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
          result,
        }));

        await database.qb.sync
          .insert(ponderSyncSchema.rpcRequestResults)
          .values(values)
          .onConflictDoUpdate({
            target: [
              ponderSyncSchema.rpcRequestResults.requestHash,
              ponderSyncSchema.rpcRequestResults.chainId,
            ],
            set: {
              result: sql`EXCLUDED.result`,
            },
          });
      },
    );
  },
  getRpcRequestResults: async ({ requests, chainId }) => {
    if (requests.length === 0) return [];
    return database.wrap(
      { method: "getRpcRequestResults", includeTraceLogs: true },
      async () => {
        const requestHashes = requests.map((request) =>
          crypto
            .createHash("md5")
            .update(toLowerCase(JSON.stringify(orderObject(request))))
            .digest("hex"),
        );

        const result = await database.qb.sync
          .select({
            request_hash: ponderSyncSchema.rpcRequestResults.requestHash,
            result: ponderSyncSchema.rpcRequestResults.result,
          })
          .from(ponderSyncSchema.rpcRequestResults)
          .where(
            and(
              eq(ponderSyncSchema.rpcRequestResults.chainId, BigInt(chainId)),
              inArray(
                ponderSyncSchema.rpcRequestResults.requestHash,
                requestHashes,
              ),
            ),
          )
          .execute();

        const results = new Map<string, string | undefined>();
        for (const row of result) {
          results.set(row.request_hash, row.result);
        }

        return requestHashes.map((requestHash) => results.get(requestHash));
      },
    );
  },
  pruneRpcRequestResults: async ({ blocks, chainId }) => {
    if (blocks.length === 0) return;
    return database.wrap(
      { method: "pruneRpcRequestResults", includeTraceLogs: true },
      async () => {
        const numbers = blocks.map(({ number }) => BigInt(hexToNumber(number)));

        await database.qb.sync
          .delete(ponderSyncSchema.rpcRequestResults)
          .where(
            and(
              eq(ponderSyncSchema.rpcRequestResults.chainId, BigInt(chainId)),
              inArray(ponderSyncSchema.rpcRequestResults.blockNumber, numbers),
            ),
          )
          .execute();
      },
    );
  },
  pruneByChain: async ({ chainId }) =>
    database.wrap({ method: "pruneByChain", includeTraceLogs: true }, () =>
      database.qb.sync.transaction(async (tx) => {
        await tx
          .delete(ponderSyncSchema.logs)
          .where(eq(ponderSyncSchema.logs.chainId, BigInt(chainId)))
          .execute();
        await tx
          .delete(ponderSyncSchema.blocks)
          .where(eq(ponderSyncSchema.blocks.chainId, BigInt(chainId)))
          .execute();

        await tx
          .delete(ponderSyncSchema.traces)
          .where(eq(ponderSyncSchema.traces.chainId, BigInt(chainId)))
          .execute();
        await tx
          .delete(ponderSyncSchema.transactions)
          .where(eq(ponderSyncSchema.transactions.chainId, BigInt(chainId)))
          .execute();
        await tx
          .delete(ponderSyncSchema.transactionReceipts)
          .where(
            eq(ponderSyncSchema.transactionReceipts.chainId, BigInt(chainId)),
          )
          .execute();
        await tx
          .delete(ponderSyncSchema.factoryAddresses)
          .where(eq(ponderSyncSchema.factoryAddresses.chainId, BigInt(chainId)))
          .execute();
      }),
    ),
});

const addressFilter = (
  address:
    | LogFilter["address"]
    | TransactionFilter["fromAddress"]
    | TransactionFilter["toAddress"],
  column: PgColumn,
): SQL => {
  // `factory` filtering is handled in-memory
  if (isAddressFactory(address)) return sql`true`;
  // @ts-ignore
  if (Array.isArray(address)) return inArray(column, address);
  // @ts-ignore
  if (typeof address === "string") return eq(column, address);
  return sql`true`;
};

export const logFilter = (filter: LogFilter): SQL => {
  const conditions: SQL[] = [];

  for (const idx of [0, 1, 2, 3] as const) {
    // If it's an array of length 1, collapse it.
    const raw = filter[`topic${idx}`] ?? null;
    if (raw === null) continue;
    const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
    if (Array.isArray(topic)) {
      conditions.push(inArray(ponderSyncSchema.logs[`topic${idx}`], topic));
    } else {
      conditions.push(eq(ponderSyncSchema.logs[`topic${idx}`], topic));
    }
  }

  conditions.push(addressFilter(filter.address, ponderSyncSchema.logs.address));

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(ponderSyncSchema.logs.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(ponderSyncSchema.logs.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};

export const blockFilter = (filter: BlockFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    sql`(blocks.number - ${filter.offset}) % ${filter.interval} = 0`,
  );

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(ponderSyncSchema.blocks.number, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(ponderSyncSchema.blocks.number, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};

export const transactionFilter = (filter: TransactionFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    addressFilter(filter.fromAddress, ponderSyncSchema.transactions.from),
  );
  conditions.push(
    addressFilter(filter.toAddress, ponderSyncSchema.transactions.to),
  );

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(ponderSyncSchema.transactions.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(ponderSyncSchema.transactions.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};

export const transferFilter = (filter: TransferFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    addressFilter(filter.fromAddress, ponderSyncSchema.traces.from),
  );
  conditions.push(addressFilter(filter.toAddress, ponderSyncSchema.traces.to));

  if (filter.includeReverted === false) {
    conditions.push(isNull(ponderSyncSchema.traces.error));
  }

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(ponderSyncSchema.traces.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(ponderSyncSchema.traces.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};

export const traceFilter = (filter: TraceFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    addressFilter(filter.fromAddress, ponderSyncSchema.traces.from),
  );
  conditions.push(addressFilter(filter.toAddress, ponderSyncSchema.traces.to));

  if (filter.includeReverted === false) {
    conditions.push(isNull(ponderSyncSchema.traces.error));
  }

  if (filter.callType !== undefined) {
    conditions.push(eq(ponderSyncSchema.traces.type, filter.callType));
  }

  if (filter.functionSelector !== undefined) {
    if (Array.isArray(filter.functionSelector)) {
      conditions.push(
        inArray(
          sql`substring(traces.input from 1 for 10)`,
          filter.functionSelector,
        ),
      );
    } else {
      conditions.push(
        eq(sql`substring(traces.input from 1 for 10)`, filter.functionSelector),
      );
    }
  }

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(ponderSyncSchema.traces.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(ponderSyncSchema.traces.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};
