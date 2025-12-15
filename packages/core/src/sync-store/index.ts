import crypto from "node:crypto";
import type { QB } from "@/database/queryBuilder.js";
import { extractBlockNumberParam } from "@/indexing/client.js";
import type { Common } from "@/internal/common.js";
import type { Logger } from "@/internal/logger.js";
import type {
  BlockFilter,
  Factory,
  Filter,
  Fragment,
  FragmentId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LightBlock,
  LogFilter,
  RequiredInternalBlockColumns,
  RequiredInternalTraceColumns,
  RequiredInternalTransactionColumns,
  RequiredInternalTransactionReceiptColumns,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type { RequestParameters } from "@/rpc/index.js";
import {
  getFilterFactories,
  isAddressFactory,
  unionFilterIncludeBlock,
  unionFilterIncludeTrace,
  unionFilterIncludeTransaction,
  unionFilterIncludeTransactionReceipt,
} from "@/runtime/filter.js";
import {
  encodeFragment,
  getFactoryFragments,
  getFragments,
} from "@/runtime/fragments.js";
import type {
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { Interval } from "@/utils/interval.js";
import { intervalUnion } from "@/utils/interval.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { orderObject } from "@/utils/order.js";
import { startClock } from "@/utils/timer.js";
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  type PgColumn,
  type PgSelectBase,
  unionAll,
} from "drizzle-orm/pg-core";
import { type Address, hexToNumber, isHex } from "viem";
import {
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encode.js";
import * as PONDER_SYNC from "./schema.js";

export type SyncStore = {
  insertIntervals(
    args: {
      intervals: IntervalWithFilter[];
      factoryIntervals: IntervalWithFactory[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getIntervals(
    args: { filters: Filter[] },
    context?: { logger?: Logger },
  ): Promise<
    Map<Filter | Factory, { fragment: Fragment; intervals: Interval[] }[]>
  >;
  insertChildAddresses(
    args: {
      factory: Factory;
      childAddresses: Map<Address, number>;
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getChildAddresses(
    args: { factory: Factory },
    context?: { logger?: Logger },
  ): Promise<Map<Address, number>>;
  getSafeCrashRecoveryBlock(
    args: {
      chainId: number;
      timestamp: number;
    },
    context?: { logger?: Logger },
  ): Promise<{ number: bigint; timestamp: bigint } | undefined>;
  insertLogs(
    args: { logs: SyncLog[]; chainId: number },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertBlocks(
    args: {
      blocks: (SyncBlock | SyncBlockHeader)[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTransactions(
    args: {
      transactions: SyncTransaction[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTransactionReceipts(
    args: {
      transactionReceipts: SyncTransactionReceipt[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  insertTraces(
    args: {
      traces: {
        trace: SyncTrace;
        block: SyncBlock;
        transaction: SyncTransaction;
      }[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getEventData(
    args: {
      filters: Filter[];
      fromBlock: number;
      toBlock: number;
      chainId: number;
      limit: number;
    },
    context?: { logger?: Logger },
  ): Promise<{
    blocks: InternalBlock[];
    logs: InternalLog[];
    transactions: InternalTransaction[];
    transactionReceipts: InternalTransactionReceipt[];
    traces: InternalTrace[];
    cursor: number;
  }>;
  insertRpcRequestResults(
    args: {
      requests: {
        request: RequestParameters;
        blockNumber: number | undefined;
        result: string;
      }[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  getRpcRequestResults(
    args: {
      requests: RequestParameters[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<(string | undefined)[]>;
  pruneRpcRequestResults(
    args: {
      blocks: Pick<LightBlock, "number">[];
      chainId: number;
    },
    context?: { logger?: Logger },
  ): Promise<void>;
  pruneByChain(
    args: { chainId: number },
    context?: { logger?: Logger },
  ): Promise<void>;
};

export const createSyncStore = ({
  common,
  qb,
}: { common: Common; qb: QB<typeof PONDER_SYNC> }): SyncStore => {
  const syncStore = {
    insertIntervals: async (
      { intervals, factoryIntervals, chainId },
      context,
    ) => {
      if (intervals.length === 0 && factoryIntervals.length === 0) return;

      const perFragmentIntervals = new Map<FragmentId, Interval[]>();
      const values: (typeof PONDER_SYNC.intervals.$inferInsert)[] = [];

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

      for (const { factory, interval } of factoryIntervals) {
        for (const fragment of getFactoryFragments(factory)) {
          const fragmentId = encodeFragment(fragment);
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

      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters / 3,
      );

      for (let i = 0; i < values.length; i += batchSize) {
        await qb.wrap(
          { label: "insert_intervals" },
          (db) =>
            db
              .insert(PONDER_SYNC.intervals)
              .values(values.slice(i, i + batchSize))
              .onConflictDoUpdate({
                target: PONDER_SYNC.intervals.fragmentId,
                set: { blocks: sql`intervals.blocks + excluded.blocks` },
              }),
          context,
        );
      }
    },
    getIntervals: async ({ filters }, context) => {
      const queries: PgSelectBase<
        "unnested",
        {
          mergedBlocks: SQL.Aliased<string>;
          fragment: SQL.Aliased<unknown>;
        },
        "partial"
      >[] = [];
      let index = 0;

      for (const filter of filters) {
        const fragments = getFragments(filter);

        for (const fragment of fragments) {
          queries.push(
            qb.raw
              .select({
                mergedBlocks: sql<string>`range_agg(unnested.blocks)`.as(
                  "merged_blocks",
                ),
                fragment: sql.raw(`'${index++}'`).as("fragment"),
              })
              .from(
                qb.raw
                  .select({ blocks: sql.raw("unnest(blocks)").as("blocks") })
                  .from(PONDER_SYNC.intervals)
                  .where(
                    sql.raw(
                      `fragment_id IN (${fragment.adjacentIds.map((id) => `'${id}'`).join(", ")})`,
                    ),
                  )
                  .as("unnested"),
              ),
          );
        }

        for (const factory of getFilterFactories(filter)) {
          for (const fragment of getFactoryFragments(factory)) {
            queries.push(
              qb.raw
                .select({
                  mergedBlocks: sql<string>`range_agg(unnested.blocks)`.as(
                    "merged_blocks",
                  ),
                  fragment: sql.raw(`'${index++}'`).as("fragment"),
                })
                .from(
                  qb.raw
                    .select({
                      blocks: sql.raw("unnest(blocks)").as("blocks"),
                    })
                    .from(PONDER_SYNC.intervals)
                    .where(
                      sql.raw(`fragment_id = '${encodeFragment(fragment)}'`),
                    )
                    .as("unnested"),
                ),
            );
          }
        }
      }

      let rows: Awaited<(typeof queries)[number]> = [];

      if (queries.length > 1) {
        // Note: This query has no parameters, but there is a bug with
        // drizzle causing a "maximum call stack size exceeded" error.
        // Related: https://github.com/drizzle-team/drizzle-orm/issues/1740
        const batchSize = 200;

        for (let i = 0; i < queries.length; i += batchSize) {
          const _rows = await qb.wrap(
            { label: "select_intervals" },
            () =>
              // @ts-expect-error
              unionAll(...queries.slice(i, i + batchSize)),
            context,
          );

          if (i === 0) {
            rows = _rows;
          } else {
            rows.push(..._rows);
          }
        }
      } else {
        rows = await qb.wrap(
          { label: "select_intervals" },
          () => queries[0]!.execute(),
          context,
        );
      }

      const result = new Map<
        Filter | Factory,
        { fragment: Fragment; intervals: Interval[] }[]
      >();

      // NOTE: `interval[1]` must be rounded down in order to offset the previous
      // rounding.

      index = 0;

      for (const filter of filters) {
        const fragments = getFragments(filter);
        result.set(filter, []);

        for (const fragment of fragments) {
          const intervals = rows
            .filter((row) => row.fragment === `${index}`)
            .map((row) =>
              (row.mergedBlocks
                ? (JSON.parse(
                    `[${row.mergedBlocks.slice(1, -1)}]`,
                  ) as Interval[])
                : []
              ).map((interval) => [interval[0], interval[1] - 1] as Interval),
            )[0]!;

          index += 1;

          result.get(filter)!.push({ fragment: fragment.fragment, intervals });
        }

        for (const factory of getFilterFactories(filter)) {
          result.set(factory, []);
          for (const fragment of getFactoryFragments(factory)) {
            const intervals = rows
              .filter((row) => row.fragment === `${index}`)
              .map((row) =>
                (row.mergedBlocks
                  ? (JSON.parse(
                      `[${row.mergedBlocks.slice(1, -1)}]`,
                    ) as Interval[])
                  : []
                ).map((interval) => [interval[0], interval[1] - 1] as Interval),
              )[0]!;

            index += 1;

            result.get(factory)!.push({ fragment, intervals });
          }

          // Note: This is a stand-in for a migration to the `intervals` table
          // required in `v0.15`. It is an invariant that filter with factories
          // have a row in the intervals table for both the filter and the factory.
          // If this invariant is broken, it must be because of the migration from
          // `v0.14` to `v0.15`. In this case, we can assume that the factory interval
          // is the same as the filter interval.

          const filterIntervals = intervalUnion(
            result.get(filter)!.flatMap(({ intervals }) => intervals),
          );
          const factoryIntervals = intervalUnion(
            result.get(factory)!.flatMap(({ intervals }) => intervals),
          );

          if (
            filterIntervals.length > 0 &&
            factoryIntervals.length === 0 &&
            filter.fromBlock === factory.fromBlock &&
            filter.toBlock === factory.toBlock
          ) {
            for (const factoryInterval of result.get(factory)!) {
              factoryInterval.intervals = filterIntervals;
            }
          }
        }
      }

      return result;
    },
    insertChildAddresses: async (
      { factory, childAddresses, chainId },
      context,
    ) => {
      if (childAddresses.size === 0) return;

      const { id, sourceId: _sourceId, ..._factory } = factory;

      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters / 3,
      );

      const values: (typeof PONDER_SYNC.factoryAddresses.$inferInsert)[] = [];

      const factoryInsert = qb.raw.$with("factory_insert").as(
        qb.raw
          .insert(PONDER_SYNC.factories)
          .values({ factory: _factory })
          // @ts-expect-error bug with drizzle-orm
          .returning({ id: PONDER_SYNC.factories.id })
          .onConflictDoUpdate({
            target: PONDER_SYNC.factories.factory,
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
        await qb.wrap(
          { label: "insert_child_addresses" },
          (db) =>
            db
              .with(factoryInsert)
              .insert(PONDER_SYNC.factoryAddresses)
              .values(values.slice(i, i + batchSize)),
          context,
        );
      }
    },
    getChildAddresses: ({ factory }, context) => {
      const { id, sourceId: _sourceId, ..._factory } = factory;

      const factoryInsert = qb.raw.$with("factory_insert").as(
        qb.raw
          .insert(PONDER_SYNC.factories)
          .values({ factory: _factory })
          // @ts-expect-error bug with drizzle-orm
          .returning({ id: PONDER_SYNC.factories.id })
          .onConflictDoUpdate({
            target: PONDER_SYNC.factories.factory,
            set: { factory: sql`excluded.factory` },
          }),
      );

      return qb
        .wrap(
          { label: "select_child_addresses" },
          (db) =>
            db
              .with(factoryInsert)
              .select({
                address: PONDER_SYNC.factoryAddresses.address,
                blockNumber: PONDER_SYNC.factoryAddresses.blockNumber,
              })
              .from(PONDER_SYNC.factoryAddresses)
              .where(
                eq(
                  PONDER_SYNC.factoryAddresses.factoryId,
                  qb.raw.select({ id: factoryInsert.id }).from(factoryInsert),
                ),
              ),
          context,
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
    getSafeCrashRecoveryBlock: async ({ chainId, timestamp }, context) => {
      const rows = await qb.wrap(
        { label: "select_crash_recovery_block" },
        (db) =>
          db
            .select({
              number: PONDER_SYNC.blocks.number,
              timestamp: PONDER_SYNC.blocks.timestamp,
            })
            .from(PONDER_SYNC.blocks)
            .where(
              and(
                eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)),
                lt(PONDER_SYNC.blocks.timestamp, BigInt(timestamp)),
              ),
            )
            .orderBy(desc(PONDER_SYNC.blocks.number))
            .limit(1),
        context,
      );

      return rows[0];
    },
    insertLogs: async ({ logs, chainId }, context) => {
      if (logs.length === 0) return;

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
        await qb.wrap(
          { label: "insert_logs" },
          (db) =>
            db
              .insert(PONDER_SYNC.logs)
              .values(
                logs
                  .slice(i, i + batchSize)
                  .map((log) => encodeLog({ log, chainId })),
              )
              .onConflictDoNothing({
                target: [
                  PONDER_SYNC.logs.chainId,
                  PONDER_SYNC.logs.blockNumber,
                  PONDER_SYNC.logs.logIndex,
                ],
              }),
          context,
        );
      }
    },
    insertBlocks: async ({ blocks, chainId }, context) => {
      if (blocks.length === 0) return;

      // Calculate `batchSize` based on how many parameters the
      // input will have
      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters /
          Object.keys(encodeBlock({ block: blocks[0]!, chainId })).length,
      );

      for (let i = 0; i < blocks.length; i += batchSize) {
        await qb.wrap(
          { label: "insert_blocks" },
          (db) =>
            db
              .insert(PONDER_SYNC.blocks)
              .values(
                blocks
                  .slice(i, i + batchSize)
                  .map((block) => encodeBlock({ block, chainId })),
              )
              .onConflictDoNothing({
                target: [PONDER_SYNC.blocks.chainId, PONDER_SYNC.blocks.number],
              }),
          context,
        );
      }
    },
    insertTransactions: async ({ transactions, chainId }, context) => {
      if (transactions.length === 0) return;

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

      for (let i = 0; i < transactions.length; i += batchSize) {
        await qb.wrap(
          { label: "insert_transactions" },
          (db) =>
            db
              .insert(PONDER_SYNC.transactions)
              .values(
                transactions
                  .slice(i, i + batchSize)
                  .map((transaction) =>
                    encodeTransaction({ transaction, chainId }),
                  ),
              )
              .onConflictDoNothing({
                target: [
                  PONDER_SYNC.transactions.chainId,
                  PONDER_SYNC.transactions.blockNumber,
                  PONDER_SYNC.transactions.transactionIndex,
                ],
              }),
          context,
        );
      }
    },
    insertTransactionReceipts: async (
      { transactionReceipts, chainId },
      context,
    ) => {
      if (transactionReceipts.length === 0) return;

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
        await qb.wrap(
          { label: "insert_transaction_receipts" },
          (db) =>
            db
              .insert(PONDER_SYNC.transactionReceipts)
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
                  PONDER_SYNC.transactionReceipts.chainId,
                  PONDER_SYNC.transactionReceipts.blockNumber,
                  PONDER_SYNC.transactionReceipts.transactionIndex,
                ],
              }),
          context,
        );
      }
    },
    insertTraces: async ({ traces, chainId }, context) => {
      if (traces.length === 0) return;

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
        await qb.wrap(
          { label: "insert_traces" },
          (db) =>
            db
              .insert(PONDER_SYNC.traces)
              .values(
                traces
                  .slice(i, i + batchSize)
                  .map(({ trace, block, transaction }) =>
                    encodeTrace({ trace, block, transaction, chainId }),
                  ),
              )
              .onConflictDoNothing({
                target: [
                  PONDER_SYNC.traces.chainId,
                  PONDER_SYNC.traces.blockNumber,
                  PONDER_SYNC.traces.transactionIndex,
                  PONDER_SYNC.traces.traceIndex,
                ],
              }),
          context,
        );
      }
    },
    getEventData: async (
      { filters, fromBlock, toBlock, chainId, limit },
      context,
    ): Promise<{
      blocks: InternalBlock[];
      logs: InternalLog[];
      transactions: InternalTransaction[];
      transactionReceipts: InternalTransactionReceipt[];
      traces: InternalTrace[];
      cursor: number;
    }> => {
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
        (filter) => filter.hasTransactionReceipt,
      );

      type BlockSelect = {
        [P in RequiredInternalBlockColumns]: (typeof PONDER_SYNC.blocks)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.blocks.$inferSelect,
          RequiredInternalBlockColumns
        >]?: (typeof PONDER_SYNC.blocks)[P];
      };
      type TransactionSelect = {
        [P in RequiredInternalTransactionColumns]: (typeof PONDER_SYNC.transactions)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.transactions.$inferSelect,
          RequiredInternalTransactionColumns
        >]?: (typeof PONDER_SYNC.transactions)[P];
      };
      type TransactionReceiptSelect = {
        [P in RequiredInternalTransactionReceiptColumns]: (typeof PONDER_SYNC.transactionReceipts)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.transactionReceipts.$inferSelect,
          RequiredInternalTransactionReceiptColumns
        >]?: (typeof PONDER_SYNC.transactionReceipts)[P];
      };
      type TraceSelect = {
        [P in RequiredInternalTraceColumns]: (typeof PONDER_SYNC.traces)[P];
      } & {
        [P in Exclude<
          keyof typeof PONDER_SYNC.traces.$inferSelect,
          RequiredInternalTraceColumns
        >]?: (typeof PONDER_SYNC.traces)[P];
      };
      // Note: `LogSelect` doesn't exist because all log columns are required.

      const blockSelect: BlockSelect = {
        number: PONDER_SYNC.blocks.number,
        hash: PONDER_SYNC.blocks.hash,
        timestamp: PONDER_SYNC.blocks.timestamp,
      };

      for (const column of unionFilterIncludeBlock(filters)) {
        // @ts-ignore
        blockSelect[column] = PONDER_SYNC.blocks[column];
      }

      const blocksQuery = qb.raw
        .select(blockSelect)
        .from(PONDER_SYNC.blocks)
        .where(
          and(
            eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.blocks.number, BigInt(fromBlock)),
            lte(PONDER_SYNC.blocks.number, BigInt(toBlock)),
          ),
        )
        .orderBy(asc(PONDER_SYNC.blocks.number))
        .limit(limit);

      const transactionSelect: TransactionSelect = {
        blockNumber: PONDER_SYNC.transactions.blockNumber,
        transactionIndex: PONDER_SYNC.transactions.transactionIndex,
        from: PONDER_SYNC.transactions.from,
        to: PONDER_SYNC.transactions.to,
        hash: PONDER_SYNC.transactions.hash,
        type: PONDER_SYNC.transactions.type,
      };

      for (const column of unionFilterIncludeTransaction(filters)) {
        // @ts-ignore
        transactionSelect[column] = PONDER_SYNC.transactions[column];
      }

      const transactionsQuery = qb.raw
        .select(transactionSelect)
        .from(PONDER_SYNC.transactions)
        .where(
          and(
            eq(PONDER_SYNC.transactions.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.transactions.blockNumber, BigInt(fromBlock)),
            lte(PONDER_SYNC.transactions.blockNumber, BigInt(toBlock)),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.transactions.blockNumber),
          asc(PONDER_SYNC.transactions.transactionIndex),
        )
        .limit(limit);

      const transactionReceiptSelect: TransactionReceiptSelect = {
        blockNumber: PONDER_SYNC.transactionReceipts.blockNumber,
        transactionIndex: PONDER_SYNC.transactionReceipts.transactionIndex,
        status: PONDER_SYNC.transactionReceipts.status,
        from: PONDER_SYNC.transactionReceipts.from,
        to: PONDER_SYNC.transactionReceipts.to,
      };

      for (const column of unionFilterIncludeTransactionReceipt(filters)) {
        // @ts-ignore
        transactionReceiptSelect[column] =
          PONDER_SYNC.transactionReceipts[column];
      }

      const transactionReceiptsQuery = qb.raw
        .select(transactionReceiptSelect)
        .from(PONDER_SYNC.transactionReceipts)
        .where(
          and(
            eq(PONDER_SYNC.transactionReceipts.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.transactionReceipts.blockNumber, BigInt(fromBlock)),
            lte(PONDER_SYNC.transactionReceipts.blockNumber, BigInt(toBlock)),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.transactionReceipts.blockNumber),
          asc(PONDER_SYNC.transactionReceipts.transactionIndex),
        )
        .limit(limit);

      const traceSelect: TraceSelect = {
        blockNumber: PONDER_SYNC.traces.blockNumber,
        transactionIndex: PONDER_SYNC.traces.transactionIndex,
        from: PONDER_SYNC.traces.from,
        to: PONDER_SYNC.traces.to,
        input: PONDER_SYNC.traces.input,
        output: PONDER_SYNC.traces.output,
        value: PONDER_SYNC.traces.value,
        type: PONDER_SYNC.traces.type,
        error: PONDER_SYNC.traces.error,
        traceIndex: PONDER_SYNC.traces.traceIndex,
      };

      for (const column of unionFilterIncludeTrace(filters)) {
        // @ts-ignore
        traceSelect[column] = PONDER_SYNC.traces[column];
      }

      const tracesQuery = qb.raw
        .select(traceSelect)
        .from(PONDER_SYNC.traces)
        .where(
          and(
            eq(PONDER_SYNC.traces.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.traces.blockNumber, BigInt(fromBlock)),
            lte(PONDER_SYNC.traces.blockNumber, BigInt(toBlock)),
            or(
              ...traceFilters.map((filter) => traceFilter(filter)),
              ...transferFilters.map((filter) => transferFilter(filter)),
            ),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.traces.blockNumber),
          asc(PONDER_SYNC.traces.transactionIndex),
          asc(PONDER_SYNC.traces.traceIndex),
        )
        .limit(limit);

      const logsQuery = qb.raw
        .select({
          blockNumber: PONDER_SYNC.logs.blockNumber,
          logIndex: PONDER_SYNC.logs.logIndex,
          transactionIndex: PONDER_SYNC.logs.transactionIndex,
          address: PONDER_SYNC.logs.address,
          topic0: PONDER_SYNC.logs.topic0,
          topic1: PONDER_SYNC.logs.topic1,
          topic2: PONDER_SYNC.logs.topic2,
          topic3: PONDER_SYNC.logs.topic3,
          data: PONDER_SYNC.logs.data,
        })
        .from(PONDER_SYNC.logs)
        .where(
          and(
            eq(PONDER_SYNC.logs.chainId, BigInt(chainId)),
            gte(PONDER_SYNC.logs.blockNumber, BigInt(fromBlock)),
            lte(PONDER_SYNC.logs.blockNumber, BigInt(toBlock)),
            or(...logFilters.map((filter) => logFilter(filter))),
          ),
        )
        .orderBy(
          asc(PONDER_SYNC.logs.blockNumber),
          asc(PONDER_SYNC.logs.logIndex),
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
          ? qb.wrap({ label: "select_blocks" }, () => blocksQuery)
          : [],
        shouldQueryTransactions
          ? qb.wrap(
              { label: "select_transactions" },
              () => transactionsQuery,
              context,
            )
          : [],
        shouldQueryTransactionReceipts
          ? qb.wrap(
              { label: "select_transaction_receipts" },
              () => transactionReceiptsQuery,
              context,
            )
          : [],
        shouldQueryLogs
          ? qb.wrap({ label: "select_logs" }, () => logsQuery, context)
          : [],
        shouldQueryTraces
          ? qb.wrap({ label: "select_traces" }, () => tracesQuery, context)
          : [],
      ]);

      const supremum = Math.min(
        blocksRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(blocksRows[blocksRows.length - 1]!.number),
        transactionsRows.length < limit
          ? Number.POSITIVE_INFINITY
          : Number(transactionsRows[transactionsRows.length - 1]!.blockNumber),
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
        cursor = supremum - 1;

        if (cursor < fromBlock) {
          return syncStore.getEventData(
            {
              filters,
              fromBlock,
              toBlock,
              chainId,
              limit: limit * 2,
            },
            context,
          );
        }
      }

      endClock = startClock();

      for (let i = 0; i < blocksRows.length; i++) {
        if (Number(blocksRows[i]!.number) > cursor) {
          blocksRows.length = i;
          break;
        }

        const block = blocksRows[i]!;

        if (block.miner) {
          block.miner = toLowerCase(block.miner);
        }
      }

      for (let i = 0; i < transactionsRows.length; i++) {
        if (Number(transactionsRows[i]!.blockNumber) > cursor) {
          transactionsRows.length = i;
          break;
        }

        const transaction = transactionsRows[i]!;
        const internalTransaction =
          transaction as unknown as InternalTransaction;

        internalTransaction.blockNumber = Number(transaction.blockNumber);
        internalTransaction.from = toLowerCase(transaction.from);
        if (transaction.to !== null) {
          internalTransaction.to = toLowerCase(transaction.to);
        }

        if (transaction.type === "0x0") {
          internalTransaction.type = "legacy";
          internalTransaction.accessList = undefined;
          internalTransaction.maxFeePerGas = undefined;
          internalTransaction.maxPriorityFeePerGas = undefined;
        } else if (transaction.type === "0x1") {
          internalTransaction.type = "eip2930";
          internalTransaction.accessList =
            transaction.accessList === undefined
              ? undefined
              : JSON.parse(transaction.accessList!);
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
      }

      for (let i = 0; i < transactionReceiptsRows.length; i++) {
        if (Number(transactionReceiptsRows[i]!.blockNumber) > cursor) {
          transactionReceiptsRows.length = i;
          break;
        }

        const transactionReceipt = transactionReceiptsRows[i]!;

        const internalTransactionReceipt =
          transactionReceipt as unknown as InternalTransactionReceipt;

        internalTransactionReceipt.blockNumber = Number(
          transactionReceipt.blockNumber,
        );
        if (transactionReceipt.contractAddress) {
          internalTransactionReceipt.contractAddress = toLowerCase(
            transactionReceipt.contractAddress,
          );
        }
        internalTransactionReceipt.from = toLowerCase(transactionReceipt.from);
        if (transactionReceipt.to !== null) {
          internalTransactionReceipt.to = toLowerCase(transactionReceipt.to);
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
      }

      for (let i = 0; i < tracesRows.length; i++) {
        if (Number(tracesRows[i]!.blockNumber) > cursor) {
          tracesRows.length = i;
          break;
        }

        const trace = tracesRows[i]!;
        const internalTrace = trace as unknown as InternalTrace;

        internalTrace.blockNumber = Number(trace.blockNumber);

        internalTrace.from = toLowerCase(trace.from);
        if (trace.to !== null) {
          internalTrace.to = toLowerCase(trace.to);
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
      }

      for (let i = 0; i < logsRows.length; i++) {
        if (Number(logsRows[i]!.blockNumber) > cursor) {
          logsRows.length = i;
          break;
        }

        const log = logsRows[i]!;
        const internalLog = log as unknown as InternalLog;

        internalLog.blockNumber = Number(log.blockNumber);
        internalLog.address = toLowerCase(log.address);
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
      }

      common.metrics.ponder_historical_extract_duration.inc(
        { step: "format" },
        endClock(),
      );

      await new Promise(setImmediate);

      return {
        blocks: blocksRows as InternalBlock[],
        logs: logsRows as InternalLog[],
        transactions: transactionsRows as InternalTransaction[],
        transactionReceipts:
          transactionReceiptsRows as InternalTransactionReceipt[],
        traces: tracesRows as InternalTrace[],
        cursor,
      };
    },
    insertRpcRequestResults: async ({ requests, chainId }, context) => {
      if (requests.length === 0) return;

      const values = requests.map(({ request, blockNumber, result }) => ({
        requestHash: crypto
          .createHash("md5")
          .update(toLowerCase(JSON.stringify(orderObject(request))))
          .digest("hex"),
        chainId: BigInt(chainId),
        blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
        result,
      }));

      await qb.wrap(
        { label: "insert_rpc_requests" },
        (db) =>
          db
            .insert(PONDER_SYNC.rpcRequestResults)
            .values(values)
            .onConflictDoNothing({
              target: [
                PONDER_SYNC.rpcRequestResults.requestHash,
                PONDER_SYNC.rpcRequestResults.chainId,
              ],
            }),
        context,
      );
    },
    getRpcRequestResults: async ({ requests, chainId }, context) => {
      if (requests.length === 0) return [];

      // Optimized fast path for high number of `requests` using a range of block numbers
      // rather than querying each request individually.

      const blockNumbersByRequest: (number | undefined)[] = new Array(
        requests.length,
      );
      const requestHashes: string[] = new Array(requests.length);

      for (let i = 0; i < requests.length; i++) {
        const request = requests[i]!;
        const blockNumber = extractBlockNumberParam(request);

        // Note: "latest" is not considered a block number
        if (isHex(blockNumber)) {
          blockNumbersByRequest[i] = hexToNumber(blockNumber);
        } else {
          blockNumbersByRequest[i] = undefined;
        }

        const requestHash = crypto
          .createHash("md5")
          .update(toLowerCase(JSON.stringify(orderObject(request))))
          .digest("hex");

        requestHashes[i] = requestHash;
      }

      const blockNumbers = blockNumbersByRequest.filter(
        (blockNumber): blockNumber is number => blockNumber !== undefined,
      );

      if (blockNumbers.length > 100) {
        const minBlockNumber = Math.min(...blockNumbers);
        const maxBlockNumber = Math.max(...blockNumbers);

        const nonBlockRequestHashes = requestHashes.filter(
          (_, i) => blockNumbersByRequest[i] === undefined,
        );

        const result = await Promise.all([
          qb.wrap(
            { label: "select_rpc_requests" },
            (db) =>
              db
                .select({
                  request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
                  result: PONDER_SYNC.rpcRequestResults.result,
                })
                .from(PONDER_SYNC.rpcRequestResults)
                .where(
                  and(
                    eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
                    gte(
                      PONDER_SYNC.rpcRequestResults.blockNumber,
                      BigInt(minBlockNumber),
                    ),
                    lte(
                      PONDER_SYNC.rpcRequestResults.blockNumber,
                      BigInt(maxBlockNumber),
                    ),
                  ),
                ),
            context,
          ),
          nonBlockRequestHashes.length === 0
            ? []
            : qb.wrap(
                { label: "select_rpc_requests" },
                (db) =>
                  db
                    .select({
                      request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
                      result: PONDER_SYNC.rpcRequestResults.result,
                    })
                    .from(PONDER_SYNC.rpcRequestResults)
                    .where(
                      and(
                        eq(
                          PONDER_SYNC.rpcRequestResults.chainId,
                          BigInt(chainId),
                        ),
                        inArray(
                          PONDER_SYNC.rpcRequestResults.requestHash,
                          nonBlockRequestHashes,
                        ),
                      ),
                    ),
                context,
              ),
        ]);

        const results = new Map<string, string | undefined>();
        for (const row of result[0]!) {
          results.set(row.request_hash, row.result);
        }
        for (const row of result[1]!) {
          results.set(row.request_hash, row.result);
        }

        return requestHashes.map((requestHash) => results.get(requestHash));
      }

      const result = await qb.wrap(
        { label: "select_rpc_requests" },
        (db) =>
          db
            .select({
              request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
              result: PONDER_SYNC.rpcRequestResults.result,
            })
            .from(PONDER_SYNC.rpcRequestResults)
            .where(
              and(
                eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
                inArray(
                  PONDER_SYNC.rpcRequestResults.requestHash,
                  requestHashes,
                ),
              ),
            ),
        context,
      );

      const results = new Map<string, string | undefined>();
      for (const row of result) {
        results.set(row.request_hash, row.result);
      }

      return requestHashes.map((requestHash) => results.get(requestHash));
    },
    pruneRpcRequestResults: async ({ blocks, chainId }, context) => {
      if (blocks.length === 0) return;

      const numbers = blocks.map(({ number }) => BigInt(hexToNumber(number)));

      await qb.wrap(
        { label: "delete_rpc_requests" },
        (db) =>
          db
            .delete(PONDER_SYNC.rpcRequestResults)
            .where(
              and(
                eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
                inArray(PONDER_SYNC.rpcRequestResults.blockNumber, numbers),
              ),
            ),
        context,
      );
    },
    pruneByChain: async ({ chainId }, context) =>
      qb.transaction(async (tx) => {
        await tx.wrap(
          { label: "delete_logs" },
          (db) =>
            db
              .delete(PONDER_SYNC.logs)
              .where(eq(PONDER_SYNC.logs.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_blocks" },
          (db) =>
            db
              .delete(PONDER_SYNC.blocks)
              .where(eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_traces" },
          (db) =>
            db
              .delete(PONDER_SYNC.traces)
              .where(eq(PONDER_SYNC.traces.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_transactions" },
          (db) =>
            db
              .delete(PONDER_SYNC.transactions)
              .where(eq(PONDER_SYNC.transactions.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_transaction_receipts" },
          (db) =>
            db
              .delete(PONDER_SYNC.transactionReceipts)
              .where(
                eq(PONDER_SYNC.transactionReceipts.chainId, BigInt(chainId)),
              )
              .execute(),
          context,
        );
        await tx.wrap(
          { label: "delete_factory_addresses" },
          (db) =>
            db
              .delete(PONDER_SYNC.factoryAddresses)
              .where(eq(PONDER_SYNC.factoryAddresses.chainId, BigInt(chainId)))
              .execute(),
          context,
        );
      }),
  } satisfies SyncStore;

  return syncStore;
};

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
      conditions.push(inArray(PONDER_SYNC.logs[`topic${idx}`], topic));
    } else {
      conditions.push(eq(PONDER_SYNC.logs[`topic${idx}`], topic));
    }
  }

  conditions.push(addressFilter(filter.address, PONDER_SYNC.logs.address));

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(PONDER_SYNC.logs.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(lte(PONDER_SYNC.logs.blockNumber, BigInt(filter.toBlock!)));
  }

  return and(...conditions)!;
};

export const blockFilter = (filter: BlockFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    sql`(blocks.number - ${filter.offset}) % ${filter.interval} = 0`,
  );

  if (filter.fromBlock !== undefined) {
    conditions.push(gte(PONDER_SYNC.blocks.number, BigInt(filter.fromBlock!)));
  }
  if (filter.toBlock !== undefined) {
    conditions.push(lte(PONDER_SYNC.blocks.number, BigInt(filter.toBlock!)));
  }

  return and(...conditions)!;
};

export const transactionFilter = (filter: TransactionFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(
    addressFilter(filter.fromAddress, PONDER_SYNC.transactions.from),
  );
  conditions.push(addressFilter(filter.toAddress, PONDER_SYNC.transactions.to));

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(PONDER_SYNC.transactions.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(PONDER_SYNC.transactions.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};

export const transferFilter = (filter: TransferFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(addressFilter(filter.fromAddress, PONDER_SYNC.traces.from));
  conditions.push(addressFilter(filter.toAddress, PONDER_SYNC.traces.to));

  if (filter.includeReverted === false) {
    conditions.push(isNull(PONDER_SYNC.traces.error));
  }

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(PONDER_SYNC.traces.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(PONDER_SYNC.traces.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};

export const traceFilter = (filter: TraceFilter): SQL => {
  const conditions: SQL[] = [];

  conditions.push(addressFilter(filter.fromAddress, PONDER_SYNC.traces.from));
  conditions.push(addressFilter(filter.toAddress, PONDER_SYNC.traces.to));

  if (filter.includeReverted === false) {
    conditions.push(isNull(PONDER_SYNC.traces.error));
  }

  if (filter.callType !== undefined) {
    conditions.push(eq(PONDER_SYNC.traces.type, filter.callType));
  }

  if (filter.functionSelector !== undefined) {
    conditions.push(
      eq(sql`substring(traces.input from 1 for 10)`, filter.functionSelector),
    );
  }

  if (filter.fromBlock !== undefined) {
    conditions.push(
      gte(PONDER_SYNC.traces.blockNumber, BigInt(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      lte(PONDER_SYNC.traces.blockNumber, BigInt(filter.toBlock!)),
    );
  }

  return and(...conditions)!;
};
