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
import { lazyChecksumAddress } from "@/utils/lazy.js";
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
import { type PgColumn, unionAll } from "drizzle-orm/pg-core";
import { type Address, type EIP1193Parameters, hexToNumber } from "viem";
import {
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encode.js";
import * as PONDER_SYNC from "./schema.js";

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
  getSafeCrashRecoveryBlock(args: {
    chainId: number;
    timestamp: number;
  }): Promise<{ number: bigint; timestamp: bigint } | undefined>;
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

    await database.syncQB
      .label("insert_intervals")
      .insert(PONDER_SYNC.intervals)
      .values(values)
      .onConflictDoUpdate({
        target: PONDER_SYNC.intervals.fragmentId,
        set: {
          blocks: sql`intervals.blocks + excluded.blocks`,
        },
      });
  },
  getIntervals: async ({ filters }) => {
    const queries = filters.flatMap((filter, i) => {
      const fragments = getFragments(filter);
      return fragments.map((fragment, j) =>
        database.syncQB
          .label("select_intervals")
          .select({
            mergedBlocks: sql<string>`range_agg(unnested.blocks)`.as(
              "merged_blocks",
            ),
            filter: sql.raw(`'${i}'`).as("filter"),
            fragment: sql.raw(`'${j}'`).as("fragment"),
          })
          .from(
            database.syncQB
              .select({ blocks: sql.raw("unnest(blocks)").as("blocks") })
              .from(PONDER_SYNC.intervals)
              .where(
                inArray(PONDER_SYNC.intervals.fragmentId, fragment.adjacentIds),
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
              ? (JSON.parse(`[${row.mergedBlocks.slice(1, -1)}]`) as Interval[])
              : []
            ).map((interval) => [interval[0], interval[1] - 1] as Interval),
          )[0]!;

        result.get(filter)!.push({ fragment: fragment.fragment, intervals });
      }
    }

    return result;
  },
  insertChildAddresses: async ({ factory, childAddresses, chainId }) => {
    if (childAddresses.size === 0) return;

    const batchSize = Math.floor(common.options.databaseMaxQueryParameters / 3);

    const values: (typeof PONDER_SYNC.factoryAddresses.$inferInsert)[] = [];

    const factoryInsert = database.syncQB.$with("factory_insert").as(
      database.syncQB
        .insert(PONDER_SYNC.factories)
        .values({ factory })
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
      await database.syncQB
        .label("insert_child_addresses")
        .with(factoryInsert)
        .insert(PONDER_SYNC.factoryAddresses)
        .values(values.slice(i, i + batchSize));
    }
  },
  getSafeCrashRecoveryBlock: async ({ chainId, timestamp }) => {
    const rows = await database.syncQB
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
      .limit(1);

    return rows[0];
  },
  getChildAddresses: ({ factory }) => {
    const factoryInsert = database.syncQB.$with("factory_insert").as(
      database.syncQB
        .insert(PONDER_SYNC.factories)
        .values({ factory })
        // @ts-expect-error bug with drizzle-orm
        .returning({ id: PONDER_SYNC.factories.id })
        .onConflictDoUpdate({
          target: PONDER_SYNC.factories.factory,
          set: { factory: sql`excluded.factory` },
        }),
    );

    return database.syncQB
      .label("select_child_addresses")
      .with(factoryInsert)
      .select({
        address: PONDER_SYNC.factoryAddresses.address,
        blockNumber: PONDER_SYNC.factoryAddresses.blockNumber,
      })
      .from(PONDER_SYNC.factoryAddresses)
      .where(
        eq(
          PONDER_SYNC.factoryAddresses.factoryId,
          database.syncQB.select({ id: factoryInsert.id }).from(factoryInsert),
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
  insertLogs: async ({ logs, chainId }) => {
    if (logs.length === 0) return;

    // Calculate `batchSize` based on how many parameters the
    // input will have
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(encodeLog({ log: logs[0]!, chainId })).length,
    );

    for (let i = 0; i < logs.length; i += batchSize) {
      await database.syncQB
        .label("insert_logs")
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
        });
    }
  },
  insertBlocks: async ({ blocks, chainId }) => {
    if (blocks.length === 0) return;

    // Calculate `batchSize` based on how many parameters the
    // input will have
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(encodeBlock({ block: blocks[0]!, chainId })).length,
    );

    for (let i = 0; i < blocks.length; i += batchSize) {
      await database.syncQB
        .label("insert_blocks")
        .insert(PONDER_SYNC.blocks)
        .values(
          blocks
            .slice(i, i + batchSize)
            .map((block) => encodeBlock({ block, chainId })),
        )
        .onConflictDoNothing({
          target: [PONDER_SYNC.blocks.chainId, PONDER_SYNC.blocks.number],
        });
    }
  },
  insertTransactions: async ({ transactions, chainId }) => {
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

    // As an optimization for the migration, transactions inserted before 0.8 do not
    // contain a checkpoint. However, for correctness the checkpoint must be inserted
    // for new transactions (using onConflictDoUpdate).

    for (let i = 0; i < transactions.length; i += batchSize) {
      await database.syncQB
        .label("insert_transactions")
        .insert(PONDER_SYNC.transactions)
        .values(
          transactions
            .slice(i, i + batchSize)
            .map((transaction) => encodeTransaction({ transaction, chainId })),
        )
        .onConflictDoNothing({
          target: [
            PONDER_SYNC.transactions.chainId,
            PONDER_SYNC.transactions.blockNumber,
            PONDER_SYNC.transactions.transactionIndex,
          ],
        });
    }
  },
  insertTransactionReceipts: async ({ transactionReceipts, chainId }) => {
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
      await database.syncQB
        .label("insert_transaction_receipts")
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
        });
    }
  },
  insertTraces: async ({ traces, chainId }) => {
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
      await database.syncQB
        .label("insert_traces")
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
        });
    }
  },
  getEventBlockData: async ({
    filters,
    fromBlock,
    toBlock,
    chainId,
    limit,
  }) => {
    const logFilters = filters.filter((f): f is LogFilter => f.type === "log");
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

    const blocksQuery = database.syncQB
      .label("select_blocks")
      .select({
        number: PONDER_SYNC.blocks.number,
        timestamp: PONDER_SYNC.blocks.timestamp,
        hash: PONDER_SYNC.blocks.hash,
        parentHash: PONDER_SYNC.blocks.parentHash,
        logsBloom: PONDER_SYNC.blocks.logsBloom,
        miner: PONDER_SYNC.blocks.miner,
        gasUsed: PONDER_SYNC.blocks.gasUsed,
        gasLimit: PONDER_SYNC.blocks.gasLimit,
        baseFeePerGas: PONDER_SYNC.blocks.baseFeePerGas,
        nonce: PONDER_SYNC.blocks.nonce,
        mixHash: PONDER_SYNC.blocks.mixHash,
        stateRoot: PONDER_SYNC.blocks.stateRoot,
        receiptsRoot: PONDER_SYNC.blocks.receiptsRoot,
        transactionsRoot: PONDER_SYNC.blocks.transactionsRoot,
        sha3Uncles: PONDER_SYNC.blocks.sha3Uncles,
        size: PONDER_SYNC.blocks.size,
        difficulty: PONDER_SYNC.blocks.difficulty,
        totalDifficulty: PONDER_SYNC.blocks.totalDifficulty,
        extraData: PONDER_SYNC.blocks.extraData,
      })
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

    const transactionsQuery = database.syncQB
      .label("select_transactions")
      .select({
        blockNumber: PONDER_SYNC.transactions.blockNumber,
        transactionIndex: PONDER_SYNC.transactions.transactionIndex,
        hash: PONDER_SYNC.transactions.hash,
        from: PONDER_SYNC.transactions.from,
        to: PONDER_SYNC.transactions.to,
        input: PONDER_SYNC.transactions.input,
        value: PONDER_SYNC.transactions.value,
        nonce: PONDER_SYNC.transactions.nonce,
        r: PONDER_SYNC.transactions.r,
        s: PONDER_SYNC.transactions.s,
        v: PONDER_SYNC.transactions.v,
        type: PONDER_SYNC.transactions.type,
        gas: PONDER_SYNC.transactions.gas,
        gasPrice: PONDER_SYNC.transactions.gasPrice,
        maxFeePerGas: PONDER_SYNC.transactions.maxFeePerGas,
        maxPriorityFeePerGas: PONDER_SYNC.transactions.maxPriorityFeePerGas,
        accessList: PONDER_SYNC.transactions.accessList,
      })
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

    const transactionReceiptsQuery = database.syncQB
      .label("select_transaction_receipts")
      .select({
        blockNumber: PONDER_SYNC.transactionReceipts.blockNumber,
        transactionIndex: PONDER_SYNC.transactionReceipts.transactionIndex,
        from: PONDER_SYNC.transactionReceipts.from,
        to: PONDER_SYNC.transactionReceipts.to,
        contractAddress: PONDER_SYNC.transactionReceipts.contractAddress,
        logsBloom: PONDER_SYNC.transactionReceipts.logsBloom,
        gasUsed: PONDER_SYNC.transactionReceipts.gasUsed,
        cumulativeGasUsed: PONDER_SYNC.transactionReceipts.cumulativeGasUsed,
        effectiveGasPrice: PONDER_SYNC.transactionReceipts.effectiveGasPrice,
        status: PONDER_SYNC.transactionReceipts.status,
        type: PONDER_SYNC.transactionReceipts.type,
      })
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

    const logsQuery = database.syncQB
      .label("select_logs")
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

    const tracesQuery = database.syncQB
      .label("select_traces")
      .select({
        blockNumber: PONDER_SYNC.traces.blockNumber,
        transactionIndex: PONDER_SYNC.traces.transactionIndex,
        traceIndex: PONDER_SYNC.traces.traceIndex,
        from: PONDER_SYNC.traces.from,
        to: PONDER_SYNC.traces.to,
        input: PONDER_SYNC.traces.input,
        output: PONDER_SYNC.traces.output,
        value: PONDER_SYNC.traces.value,
        type: PONDER_SYNC.traces.type,
        gas: PONDER_SYNC.traces.gas,
        gasUsed: PONDER_SYNC.traces.gasUsed,
        error: PONDER_SYNC.traces.error,
        revertReason: PONDER_SYNC.traces.revertReason,
        subcalls: PONDER_SYNC.traces.subcalls,
      })
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
        asc(PONDER_SYNC.traces.traceIndex),
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
      shouldQueryBlocks ? blocksQuery : [],
      shouldQueryTransactions ? transactionsQuery : [],
      shouldQueryTransactionReceipts ? transactionReceiptsQuery : [],
      shouldQueryLogs ? logsQuery : [],
      shouldQueryTraces ? tracesQuery : [],
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
        lazyChecksumAddress(internalTransaction, "from");
        if (transaction.to !== null) {
          lazyChecksumAddress(internalTransaction, "to");
        }

        if (transaction.type === "0x0") {
          internalTransaction.type = "legacy";
          internalTransaction.accessList = undefined;
          internalTransaction.maxFeePerGas = undefined;
          internalTransaction.maxPriorityFeePerGas = undefined;
        } else if (transaction.type === "0x1") {
          internalTransaction.type = "eip2930";
          internalTransaction.accessList = JSON.parse(transaction.accessList!);
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
          lazyChecksumAddress(internalTransactionReceipt, "contractAddress");
        }
        lazyChecksumAddress(internalTransactionReceipt, "from");
        if (transactionReceipt.to !== null) {
          lazyChecksumAddress(internalTransactionReceipt, "to");
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
        lazyChecksumAddress(internalLog, "address");
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

        lazyChecksumAddress(internalTrace, "from");
        if (trace.to !== null) {
          lazyChecksumAddress(internalTrace, "to");
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

      lazyChecksumAddress(block, "miner");

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

  insertRpcRequestResults: async ({ requests, chainId }) => {
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

    await database.syncQB
      .label("insert_rpc_request_results")
      .insert(PONDER_SYNC.rpcRequestResults)
      .values(values)
      .onConflictDoUpdate({
        target: [
          PONDER_SYNC.rpcRequestResults.requestHash,
          PONDER_SYNC.rpcRequestResults.chainId,
        ],
        set: {
          result: sql`EXCLUDED.result`,
        },
      });
  },
  getRpcRequestResults: async ({ requests, chainId }) => {
    if (requests.length === 0) return [];

    const requestHashes = requests.map((request) =>
      crypto
        .createHash("md5")
        .update(toLowerCase(JSON.stringify(orderObject(request))))
        .digest("hex"),
    );

    const result = await database.syncQB
      .label("select_rpc_request_results")
      .select({
        request_hash: PONDER_SYNC.rpcRequestResults.requestHash,
        result: PONDER_SYNC.rpcRequestResults.result,
      })
      .from(PONDER_SYNC.rpcRequestResults)
      .where(
        and(
          eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
          inArray(PONDER_SYNC.rpcRequestResults.requestHash, requestHashes),
        ),
      )
      .execute();

    const results = new Map<string, string | undefined>();
    for (const row of result) {
      results.set(row.request_hash, row.result);
    }

    return requestHashes.map((requestHash) => results.get(requestHash));
  },
  pruneRpcRequestResults: async ({ blocks, chainId }) => {
    if (blocks.length === 0) return;

    const numbers = blocks.map(({ number }) => BigInt(hexToNumber(number)));

    await database.syncQB
      .label("delete_rpc_request_results")
      .delete(PONDER_SYNC.rpcRequestResults)
      .where(
        and(
          eq(PONDER_SYNC.rpcRequestResults.chainId, BigInt(chainId)),
          inArray(PONDER_SYNC.rpcRequestResults.blockNumber, numbers),
        ),
      )
      .execute();
  },
  pruneByChain: async ({ chainId }) =>
    database.syncQB.transaction(async (tx) => {
      await tx
        .label("delete_logs")
        .delete(PONDER_SYNC.logs)
        .where(eq(PONDER_SYNC.logs.chainId, BigInt(chainId)))
        .execute();
      await tx
        .label("delete_blocks")
        .delete(PONDER_SYNC.blocks)
        .where(eq(PONDER_SYNC.blocks.chainId, BigInt(chainId)))
        .execute();
      await tx
        .label("delete_traces")
        .delete(PONDER_SYNC.traces)
        .where(eq(PONDER_SYNC.traces.chainId, BigInt(chainId)))
        .execute();
      await tx
        .label("delete_transactions")
        .delete(PONDER_SYNC.transactions)
        .where(eq(PONDER_SYNC.transactions.chainId, BigInt(chainId)))
        .execute();
      await tx
        .label("delete_transaction_receipts")
        .delete(PONDER_SYNC.transactionReceipts)
        .where(eq(PONDER_SYNC.transactionReceipts.chainId, BigInt(chainId)))
        .execute();
      await tx
        .label("delete_factory_addresses")
        .delete(PONDER_SYNC.factoryAddresses)
        .where(eq(PONDER_SYNC.factoryAddresses.chainId, BigInt(chainId)))
        .execute();
    }),
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
