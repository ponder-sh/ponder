import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import type {
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
  LogFactory,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import { shouldGetTransactionReceipt } from "@/sync/filter.js";
import { fragmentToId, getFragments } from "@/sync/fragments.js";
import {
  ZERO_CHECKPOINT,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import type { Interval } from "@/utils/interval.js";
import { type SelectQueryBuilder, sql as ksql } from "kysely";
import type { InsertObject } from "kysely";
import { type Address, type Hex, hexToBigInt } from "viem";
import {
  type PonderSyncSchema,
  decodeBlock,
  decodeLog,
  decodeTrace,
  decodeTransaction,
  decodeTransactionReceipt,
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encoding.js";

export type SyncStore = {
  insertIntervals(args: {
    intervals: {
      filter: FilterWithoutBlocks;
      interval: Interval;
    }[];
    chainId: number;
  }): Promise<void>;
  getIntervals(args: {
    filters: Filter[];
  }): Promise<Map<Filter, { fragment: Fragment; intervals: Interval[] }[]>>;
  getChildAddresses(args: {
    filter: Factory;
    limit?: number;
  }): Promise<Address[]>;
  filterChildAddresses(args: {
    filter: Factory;
    addresses: Address[];
  }): Promise<Set<Address>>;
  insertLogs(args: {
    logs: SyncLog[];
    chainId: number;
  }): Promise<void>;
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
  /** Returns an ordered list of events based on the `filters` and pagination arguments. */
  getEventBlockData(args: {
    filters: Filter[];
    from: string;
    to: string;
    chainId: number;
    limit?: number;
  }): Promise<{
    blockData: {
      block: InternalBlock;
      logs: InternalLog[];
      transactions: InternalTransaction[];
      transactionReceipts: InternalTransactionReceipt[];
      traces: InternalTrace[];
    }[];
    cursor: string;
  }>;
  insertRpcRequestResult(args: {
    request: string;
    chainId: number;
    blockNumber: bigint | undefined;
    result: string;
  }): Promise<void>;
  getRpcRequestResult(args: {
    request: string;
    chainId: number;
  }): Promise<string | undefined>;
  pruneRpcRequestResult(args: {
    blocks: Pick<LightBlock, "number">[];
    chainId: number;
  }): Promise<void>;
  pruneByChain(args: { chainId: number }): Promise<void>;
};

const logFactorySQL = (
  qb: SelectQueryBuilder<PonderSyncSchema, "logs", {}>,
  factory: LogFactory,
) =>
  qb
    .select(
      (() => {
        if (factory.childAddressLocation.startsWith("offset")) {
          const childAddressOffset = Number(
            factory.childAddressLocation.substring(6),
          );
          const start = 2 + 12 * 2 + childAddressOffset * 2 + 1;
          const length = 20 * 2;
          return ksql<Hex>`'0x' || substring(data from ${start}::int for ${length}::int)`;
        } else {
          const start = 2 + 12 * 2 + 1;
          const length = 20 * 2;
          return ksql<Hex>`'0x' || substring(${ksql.ref(
            factory.childAddressLocation,
          )} from ${start}::integer for ${length}::integer)`;
        }
      })().as("childAddress"),
    )
    .distinct()
    .$call((qb) => {
      if (Array.isArray(factory.address)) {
        return qb.where("address", "in", factory.address);
      }
      return qb.where("address", "=", factory.address);
    })
    .where("topic0", "=", factory.eventSelector)
    .where("chain_id", "=", factory.chainId);

export const createSyncStore = ({
  common,
  database,
}: {
  common: Common;
  database: Database;
}): SyncStore => ({
  insertIntervals: async ({ intervals, chainId }) => {
    if (intervals.length === 0) return;

    await database.wrap(
      { method: "insertIntervals", includeTraceLogs: true },
      async () => {
        const perFragmentIntervals = new Map<FragmentId, Interval[]>();
        const values: InsertObject<PonderSyncSchema, "intervals">[] = [];

        // dedupe and merge matching fragments

        for (const { filter, interval } of intervals) {
          for (const fragment of getFragments(filter)) {
            const fragmentId = fragmentToId(fragment.fragment);
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
            fragment_id: fragmentId,
            chain_id: chainId,
            blocks: ksql.raw(`nummultirange(${numranges})`),
          });
        }

        await database.qb.sync
          .insertInto("intervals")
          .values(values)
          .onConflict((oc) =>
            oc.column("fragment_id").doUpdateSet({
              blocks: ksql`intervals.blocks + excluded.blocks`,
            }),
          )
          .execute();
      },
    );
  },
  getIntervals: async ({ filters }) =>
    database.wrap(
      { method: "getIntervals", includeTraceLogs: true },
      async () => {
        let query:
          | SelectQueryBuilder<
              PonderSyncSchema,
              "intervals",
              { merged_blocks: string | null; filter: string; fragment: string }
            >
          | undefined;

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i]!;
          const fragments = getFragments(filter);
          for (let j = 0; j < fragments.length; j++) {
            const fragment = fragments[j]!;
            const _query = database.qb.sync
              .selectFrom(
                database.qb.sync
                  .selectFrom("intervals")
                  .select(ksql`unnest(blocks)`.as("blocks"))
                  .where("fragment_id", "in", fragment.adjacentIds)
                  .as("unnested"),
              )
              .select([
                ksql<string>`range_agg(unnested.blocks)`.as("merged_blocks"),
                ksql.raw(`'${i}'`).as("filter"),
                ksql.raw(`'${j}'`).as("fragment"),
              ]);
            // @ts-ignore
            query = query === undefined ? _query : query.unionAll(_query);
          }
        }

        const rows = await query!.execute();

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
                (row.merged_blocks
                  ? (JSON.parse(
                      `[${row.merged_blocks.slice(1, -1)}]`,
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
  getChildAddresses: ({ filter, limit }) =>
    database.wrap(
      { method: "getChildAddresses", includeTraceLogs: true },
      async () => {
        return await database.qb.sync
          .selectFrom("logs")
          .$call((qb) => logFactorySQL(qb, filter))
          .$if(limit !== undefined, (qb) => qb.limit(limit!))
          .execute()
          .then((addresses) =>
            addresses.map(({ childAddress }) => childAddress),
          );
      },
    ),
  filterChildAddresses: ({ filter, addresses }) =>
    database.wrap(
      { method: "filterChildAddresses", includeTraceLogs: true },
      async () => {
        const result = await database.qb.sync
          .with(
            "addresses(address)",
            () =>
              ksql`( values ${ksql.join(addresses.map((a) => ksql`( ${ksql.val(a)} )`))} )`,
          )
          .with("childAddresses", (db) =>
            db.selectFrom("logs").$call((qb) => logFactorySQL(qb, filter)),
          )
          .selectFrom("addresses")
          .where(
            "addresses.address",
            "in",
            ksql`(SELECT "childAddress" FROM "childAddresses")`,
          )
          .selectAll()
          .execute();

        return new Set<Address>([...result.map(({ address }) => address)]);
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
            .insertInto("logs")
            .values(
              logs
                .slice(i, i + batchSize)
                .map((log) => encodeLog({ log, chainId })),
            )
            .onConflict((oc) =>
              oc.columns(["chain_id", "block_number", "log_index"]).doNothing(),
            )
            .execute();
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
            .insertInto("blocks")
            .values(
              blocks
                .slice(i, i + batchSize)
                .map((block) => encodeBlock({ block, chainId })),
            )
            .onConflict((oc) => oc.columns(["chain_id", "number"]).doNothing())
            .execute();
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
            .insertInto("transactions")
            .values(
              transactions
                .slice(i, i + batchSize)
                .map((transaction) =>
                  encodeTransaction({ transaction, chainId }),
                ),
            )
            .onConflict((oc) =>
              oc
                .columns(["chain_id", "block_number", "transaction_index"])
                .doNothing(),
            )
            .execute();
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
            .insertInto("transaction_receipts")
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
            .onConflict((oc) =>
              oc
                .columns(["chain_id", "block_number", "transaction_index"])
                .doNothing(),
            )
            .execute();
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
            .insertInto("traces")
            .values(
              traces
                .slice(i, i + batchSize)
                .map(({ trace, block, transaction }) =>
                  encodeTrace({ trace, block, transaction, chainId }),
                ),
            )
            .onConflict((oc) =>
              oc
                .columns([
                  "chain_id",
                  "block_number",
                  "transaction_index",
                  "trace_index",
                ])
                .doNothing(),
            )
            .execute();
        }
      },
    );
  },
  getEventBlockData: async ({ filters, from, to, chainId, limit }) =>
    database.wrap({ method: "getEvents", includeTraceLogs: true }, async () => {
      // Note: `from` and `to` must be chain-specific
      const fromBlock = Number(decodeCheckpoint(from).blockNumber);
      // const fromEventIndex =
      //   decodeCheckpoint(from).eventIndex > 2147483647n
      //     ? 2147483647n
      //     : decodeCheckpoint(from).eventIndex;
      const toBlock = Number(decodeCheckpoint(to).blockNumber);
      // const toEventIndex =
      //   decodeCheckpoint(to).eventIndex > 2147483647n
      //     ? 2147483647n
      //     : decodeCheckpoint(to).eventIndex;

      // TODO(kyle) use relative density heuristics to set
      // different limits for each query

      const shouldQueryBlocks = true;
      const shouldQueryLogs = filters.some((f) => f.type === "log");
      const shouldQueryTraces = filters.some((f) => f.type === "trace");
      const shouldQueryTransactions =
        filters.some((f) => f.type === "transaction") ||
        shouldQueryLogs ||
        shouldQueryTraces;
      const shouldQueryTransactionReceipts = filters.some(
        shouldGetTransactionReceipt,
      );

      // TODO(kyle) prepared statements

      const blocksQ = database.qb.sync
        .selectFrom("blocks")
        .selectAll()
        .where("chain_id", "=", chainId)
        .where("number", ">", fromBlock)
        .where("number", "<=", toBlock)
        .orderBy("number", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const transactionsQ = database.qb.sync
        .selectFrom("transactions")
        .selectAll()
        .where("chain_id", "=", chainId)
        .where("block_number", ">", fromBlock)
        // .where("transaction_index", ">", Number(fromEventIndex))
        .where("block_number", "<=", toBlock)
        // .where("transaction_index", "<=", Number(toEventIndex))
        .orderBy("block_number", "asc")
        .orderBy("transaction_index", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const transactionReceiptsQ = database.qb.sync
        .selectFrom("transaction_receipts")
        .selectAll()
        .where("block_number", ">", fromBlock)
        // .where("transaction_index", ">", Number(fromEventIndex))
        .where("block_number", "<=", toBlock)
        // .where("transaction_index", "<=", Number(toEventIndex))
        .orderBy("block_number", "asc")
        .orderBy("transaction_index", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const logsQ = database.qb.sync
        .selectFrom("logs")
        .selectAll()
        .where("chain_id", "=", chainId)
        .where("block_number", ">", fromBlock)
        // .where("log_index", ">", Number(fromEventIndex))
        .where("block_number", "<=", toBlock)
        // .where("log_index", "<=", Number(toEventIndex))
        .orderBy("block_number", "asc")
        .orderBy("log_index", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const tracesQ = database.qb.sync
        .selectFrom("traces")
        .selectAll()
        .where("block_number", ">", fromBlock)
        // .where("trace_index", ">", Number(fromEventIndex))
        .where("block_number", "<=", toBlock)
        // .where("trace_index", "<=", Number(toEventIndex))
        .orderBy("block_number", "asc")
        .orderBy("trace_index", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const [
        logsRows,
        blocksRows,
        transactionsRows,
        transactionReceiptsRows,
        tracesRows,
      ] = await Promise.all([
        shouldQueryLogs ? logsQ.execute() : [],
        shouldQueryBlocks ? blocksQ.execute() : [],
        shouldQueryTransactions ? transactionsQ.execute() : [],
        shouldQueryTransactionReceipts ? transactionReceiptsQ.execute() : [],
        shouldQueryTraces ? tracesQ.execute() : [],
      ]);

      const supremum = Math.min(
        logsRows.length === 0
          ? Number.POSITIVE_INFINITY
          : Number(logsRows[logsRows.length - 1]!.block_number),
        blocksRows.length === 0
          ? Number.POSITIVE_INFINITY
          : Number(blocksRows[blocksRows.length - 1]!.number),
        transactionsRows.length === 0
          ? Number.POSITIVE_INFINITY
          : Number(transactionsRows[transactionsRows.length - 1]!.block_number),
        transactionReceiptsRows.length === 0
          ? Number.POSITIVE_INFINITY
          : Number(
              transactionReceiptsRows[transactionReceiptsRows.length - 1]!
                .block_number,
            ),
        tracesRows.length === 0
          ? Number.POSITIVE_INFINITY
          : Number(tracesRows[tracesRows.length - 1]!.block_number),
      );

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
          transactionsRows[transactionIndex]!.block_number === block.number
        ) {
          const transaction = transactionsRows[transactionIndex]!;
          transactions.push(decodeTransaction({ transaction }));
          transactionIndex++;
        }

        while (
          transactionReceiptIndex < transactionReceiptsRows.length &&
          transactionReceiptsRows[transactionReceiptIndex]!.block_number ===
            block.number
        ) {
          const transactionReceipt =
            transactionReceiptsRows[transactionReceiptIndex]!;
          transactionReceipts.push(
            decodeTransactionReceipt({ transactionReceipt }),
          );
          transactionReceiptIndex++;
        }

        while (
          logIndex < logsRows.length &&
          logsRows[logIndex]!.block_number === block.number
        ) {
          const log = logsRows[logIndex]!;
          logs.push(decodeLog({ log }));
          logIndex++;
        }

        while (
          traceIndex < tracesRows.length &&
          tracesRows[traceIndex]!.block_number === block.number
        ) {
          const trace = tracesRows[traceIndex]!;
          traces.push(decodeTrace({ trace }));
          traceIndex++;
        }

        blockData.push({
          block: decodeBlock({ block }),
          logs,
          transactions,
          traces,
          transactionReceipts,
        });
      }

      let cursor: string;
      if (
        Math.max(
          logsRows.length,
          blocksRows.length,
          transactionsRows.length,
          transactionReceiptsRows.length,
          tracesRows.length,
        ) !== limit
      ) {
        cursor = to;
      } else {
        blockData.pop();
        cursor = encodeCheckpoint({
          ...ZERO_CHECKPOINT,
          // TODO(kyle) this currently only works for multichain
          chainId: BigInt(chainId),
          blockNumber: BigInt(supremum - 1),
        });
      }

      return { blockData, cursor };
    }),
  insertRpcRequestResult: async ({ request, blockNumber, chainId, result }) =>
    database.wrap(
      { method: "insertRpcRequestResult", includeTraceLogs: true },
      async () => {
        await database.qb.sync
          .insertInto("rpc_request_results")
          .values({
            request,
            block_number: blockNumber,
            chain_id: chainId,
            result,
          })
          .onConflict((oc) =>
            oc.columns(["request_hash", "chain_id"]).doUpdateSet({ result }),
          )
          .execute();
      },
    ),
  getRpcRequestResult: async ({ request, chainId }) =>
    database.wrap(
      { method: "getRpcRequestResult", includeTraceLogs: true },
      async () => {
        const result = await database.qb.sync
          .selectFrom("rpc_request_results")
          .select("result")
          .where("request_hash", "=", ksql`MD5(${request})`)
          .where("chain_id", "=", chainId)
          .executeTakeFirst();

        return result?.result;
      },
    ),
  pruneRpcRequestResult: async ({ blocks, chainId }) =>
    database.wrap(
      { method: "pruneRpcRequestResult", includeTraceLogs: true },
      async () => {
        if (blocks.length === 0) return;

        const numbers = blocks.map(({ number }) =>
          hexToBigInt(number).toString(),
        );

        await database.qb.sync
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .where("block_number", "in", numbers)
          .execute();
      },
    ),
  pruneByChain: async ({ chainId }) =>
    database.wrap({ method: "pruneByChain", includeTraceLogs: true }, () =>
      database.qb.sync.transaction().execute(async (tx) => {
        await tx.deleteFrom("logs").where("chain_id", "=", chainId).execute();
        await tx.deleteFrom("blocks").where("chain_id", "=", chainId).execute();
        await tx
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .execute();
        await tx.deleteFrom("traces").where("chain_id", "=", chainId).execute();
        await tx
          .deleteFrom("transactions")
          .where("chain_id", "=", chainId)
          .execute();
        await tx
          .deleteFrom("transaction_receipts")
          .where("chain_id", "=", chainId)
          .execute();
      }),
    ),
});
