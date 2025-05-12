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
  type ExpressionBuilder,
  type OperandExpression,
  type SelectQueryBuilder,
  type SqlBool,
  sql,
} from "kysely";
import type { InsertObject } from "kysely";
import {
  type Address,
  type EIP1193Parameters,
  checksumAddress,
  hexToNumber,
} from "viem";
import {
  type PonderSyncSchema,
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encoding.js";

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
        const values: InsertObject<PonderSyncSchema, "intervals">[] = [];

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
            fragment_id: fragmentId,
            chain_id: chainId,
            blocks: sql.raw(`nummultirange(${numranges})`),
          });
        }

        await database.qb.sync
          .insertInto("intervals")
          .values(values)
          .onConflict((oc) =>
            oc.column("fragment_id").doUpdateSet({
              blocks: sql`intervals.blocks + excluded.blocks`,
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
                  .select(sql`unnest(blocks)`.as("blocks"))
                  .where("fragment_id", "in", fragment.adjacentIds)
                  .as("unnested"),
              )
              .select([
                sql<string>`range_agg(unnested.blocks)`.as("merged_blocks"),
                sql.raw(`'${i}'`).as("filter"),
                sql.raw(`'${j}'`).as("fragment"),
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
  insertChildAddresses: async ({ factory, childAddresses, chainId }) => {
    if (childAddresses.size === 0) return;
    await database.wrap(
      { method: "insertChildAddresses", includeTraceLogs: true },
      async () => {
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters / 3,
        );

        const values: InsertObject<PonderSyncSchema, "factory_addresses">[] =
          [];
        for (const [address, blockNumber] of childAddresses) {
          values.push({
            factory_id: sql`(SELECT id FROM factory_insert)`,
            chain_id: chainId,
            block_number: blockNumber,
            address: address,
          });
        }

        for (let i = 0; i < values.length; i += batchSize) {
          await database.qb.sync
            .with("factory_insert", (qb) =>
              qb
                .insertInto("factories")
                .values({ factory })
                .returning("id")
                .onConflict((oc) =>
                  oc
                    .column("factory")
                    .doUpdateSet({ factory: sql`excluded.factory` }),
                ),
            )
            .insertInto("factory_addresses")
            .values(values.slice(i, i + batchSize))
            .execute();
        }
      },
    );
  },
  getChildAddresses: ({ factory }) =>
    database.wrap({ method: "getChildAddresses", includeTraceLogs: true }, () =>
      database.qb.sync
        .with("factory_insert", (qb) =>
          qb
            .insertInto("factories")
            .values({ factory })
            .returning("id")
            .onConflict((oc) =>
              oc
                .column("factory")
                .doUpdateSet({ factory: sql`excluded.factory` }),
            ),
        )
        .selectFrom("factory_addresses")
        .select(["factory_addresses.address", "factory_addresses.block_number"])
        .where(
          "factory_addresses.factory_id",
          "=",
          sql`(SELECT id FROM factory_insert)`,
        )
        .execute()
        .then((rows) => {
          const result = new Map<Address, number>();
          for (const { address, block_number } of rows) {
            if (
              result.has(address) === false ||
              result.get(address)! > Number(block_number)
            ) {
              result.set(address, Number(block_number));
            }
          }
          return result;
        }),
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
          .selectFrom("blocks")
          .where("blocks.chain_id", "=", String(chainId))
          .where("blocks.number", ">=", String(fromBlock))
          .where("blocks.number", "<=", String(toBlock))
          .orderBy("blocks.number", "asc")
          .select([
            "number",
            "timestamp",
            "hash",
            sql<string>`parent_hash`.as("parentHash"),
            sql<string>`logs_bloom`.as("logsBloom"),
            "miner",
            sql<string>`gas_used`.as("gasUsed"),
            sql<string>`gas_limit`.as("gasLimit"),
            sql<string>`base_fee_per_gas`.as("baseFeePerGas"),
            "nonce",
            sql<string>`mix_hash`.as("mixHash"),
            sql<string>`state_root`.as("stateRoot"),
            sql<string>`receipts_root`.as("receiptsRoot"),
            sql<string>`transactions_root`.as("transactionsRoot"),
            sql<string>`sha3_uncles`.as("sha3Uncles"),
            "size",
            "difficulty",
            sql<string>`total_difficulty`.as("totalDifficulty"),
            sql<string>`extra_data`.as("extraData"),
          ])
          .limit(limit);

        const transactionsQuery = database.qb.sync
          .selectFrom("transactions")
          .where("chain_id", "=", String(chainId))
          .where("block_number", ">=", String(fromBlock))
          .where("block_number", "<=", String(toBlock))
          .orderBy("block_number", "asc")
          .orderBy("transaction_index", "asc")
          .select([
            sql<string>`block_number`.as("blockNumber"),
            sql<number>`transaction_index`.as("transactionIndex"),
            "hash",
            "from",
            "to",
            "input",
            "value",
            "nonce",
            "r",
            "s",
            "v",
            "type",
            "gas",
            sql<string | null>`gas_price`.as("gasPrice"),
            sql<string | null>`max_fee_per_gas`.as("maxFeePerGas"),
            sql<string | null>`max_priority_fee_per_gas`.as(
              "maxPriorityFeePerGas",
            ),
            sql<string | null>`access_list`.as("accessList"),
          ])
          .limit(limit);

        const transactionReceiptsQuery = database.qb.sync
          .selectFrom("transaction_receipts")
          .where("chain_id", "=", String(chainId))
          .where("block_number", ">=", String(fromBlock))
          .where("block_number", "<=", String(toBlock))
          .orderBy("block_number", "asc")
          .orderBy("transaction_index", "asc")
          .select([
            sql<string>`block_number`.as("blockNumber"),
            sql<number>`transaction_index`.as("transactionIndex"),
            "from",
            "to",
            sql<Address | null>`contract_address`.as("contractAddress"),
            sql<string>`logs_bloom`.as("logsBloom"),
            sql<string>`gas_used`.as("gasUsed"),
            sql<string>`cumulative_gas_used`.as("cumulativeGasUsed"),
            sql<string>`effective_gas_price`.as("effectiveGasPrice"),
            "status",
            "type",
          ])
          .limit(limit);

        const logsQuery = database.qb.sync
          .selectFrom("logs")
          .where("logs.chain_id", "=", String(chainId))
          .where("logs.block_number", ">=", String(fromBlock))
          .where("logs.block_number", "<=", String(toBlock))
          .where((eb) => eb.or(logFilters.map((f) => logFilter(eb, f))))
          .orderBy("logs.block_number", "asc")
          .orderBy("logs.log_index", "asc")
          .select([
            sql<string>`block_number`.as("blockNumber"),
            sql<number>`log_index`.as("logIndex"),
            sql<number>`transaction_index`.as("transactionIndex"),
            "address",
            "topic0",
            "topic1",
            "topic2",
            "topic3",
            "data",
          ])
          .limit(limit);

        const tracesQuery = database.qb.sync
          .selectFrom("traces")
          .where("chain_id", "=", String(chainId))
          .where("block_number", ">=", String(fromBlock))
          .where("block_number", "<=", String(toBlock))
          .where((eb) =>
            eb.or([
              ...traceFilters.map((f) => traceFilter(eb, f)),
              ...transferFilters.map((f) => transferFilter(eb, f)),
            ]),
          )
          .orderBy("block_number", "asc")
          .orderBy("trace_index", "asc")
          .select([
            sql<string>`block_number`.as("blockNumber"),
            sql<number>`transaction_index`.as("transactionIndex"),
            sql<number>`trace_index`.as("traceIndex"),
            "from",
            "to",
            "input",
            "output",
            "value",
            "type",
            "gas",
            sql<string>`gas_used`.as("gasUsed"),
            "error",
            sql<string | null>`revert_reason`.as("revertReason"),
            "subcalls",
          ])
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
            ? blocksQuery.execute().then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_blocks" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryTransactions
            ? transactionsQuery.execute().then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_transactions" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryTransactionReceipts
            ? transactionReceiptsQuery.execute().then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_transaction_receipts" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryLogs
            ? logsQuery.execute().then((res) => {
                common.metrics.ponder_database_method_duration.observe(
                  { method: "getEventBlockData_logs" },
                  endClock(),
                );

                return res;
              })
            : [],
          shouldQueryTraces
            ? tracesQuery.execute().then((res) => {
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
            internalTransaction.value = BigInt(transaction.value);
            if (transaction.v !== null) {
              internalTransaction.v = BigInt(transaction.v);
            }
            internalTransaction.gas = BigInt(transaction.gas);

            if (transaction.type === "0x0") {
              internalTransaction.type = "legacy";
              internalTransaction.gasPrice = BigInt(transaction.gasPrice!);
              internalTransaction.accessList = undefined;
              internalTransaction.maxFeePerGas = undefined;
              internalTransaction.maxPriorityFeePerGas = undefined;
            } else if (transaction.type === "0x1") {
              internalTransaction.type = "eip2930";
              internalTransaction.gasPrice = BigInt(transaction.gasPrice!);
              internalTransaction.accessList = JSON.parse(
                transaction.accessList!,
              );
              internalTransaction.maxFeePerGas = undefined;
              internalTransaction.maxPriorityFeePerGas = undefined;
            } else if (transaction.type === "0x2") {
              internalTransaction.type = "eip1559";
              internalTransaction.maxFeePerGas = BigInt(
                transaction.maxFeePerGas!,
              );
              internalTransaction.maxPriorityFeePerGas = BigInt(
                transaction.maxPriorityFeePerGas!,
              );
              internalTransaction.gasPrice = undefined;
              internalTransaction.accessList = undefined;
            } else if (transaction.type === "0x7e") {
              internalTransaction.type = "deposit";
              if (transaction.maxFeePerGas !== null) {
                internalTransaction.maxFeePerGas = BigInt(
                  transaction.maxFeePerGas!,
                );
              }
              if (transaction.maxPriorityFeePerGas !== null) {
                internalTransaction.maxPriorityFeePerGas = BigInt(
                  transaction.maxPriorityFeePerGas!,
                );
              }
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
            internalTransactionReceipt.gasUsed = BigInt(
              transactionReceipt.gasUsed,
            );
            internalTransactionReceipt.cumulativeGasUsed = BigInt(
              transactionReceipt.cumulativeGasUsed,
            );
            internalTransactionReceipt.effectiveGasPrice = BigInt(
              transactionReceipt.effectiveGasPrice,
            );
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

            if (trace.value !== null) {
              internalTrace.value = BigInt(trace.value);
            }
            internalTrace.gas = BigInt(trace.gas);
            internalTrace.gasUsed = BigInt(trace.gasUsed);

            if (trace.error === null) {
              internalTrace.error = undefined;
            }

            if (trace.revertReason === null) {
              internalTrace.revertReason = undefined;
            }

            traces.push(internalTrace);
            traceIndex++;
          }

          const internalBlock = block as unknown as InternalBlock;

          internalBlock.number = BigInt(block.number);
          internalBlock.timestamp = BigInt(block.timestamp);
          internalBlock.gasUsed = BigInt(block.gasUsed);
          internalBlock.miner = checksumAddress(block.miner);
          internalBlock.gasLimit = BigInt(block.gasLimit);
          if (block.baseFeePerGas !== null) {
            internalBlock.baseFeePerGas = BigInt(block.baseFeePerGas);
          }
          internalBlock.size = BigInt(block.size);
          internalBlock.difficulty = BigInt(block.difficulty);
          if (block.totalDifficulty !== null) {
            internalBlock.totalDifficulty = BigInt(block.totalDifficulty);
          }

          blockData.push({
            block: internalBlock,
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
          request_hash: crypto
            .createHash("md5")
            .update(toLowerCase(JSON.stringify(orderObject(request))))
            .digest("hex"),
          chain_id: chainId,
          block_number: blockNumber,
          result,
        }));

        await database.qb.sync
          .insertInto("rpc_request_results")
          .values(values)
          .onConflict((oc) =>
            oc
              .columns(["request_hash", "chain_id"])
              .doUpdateSet({ result: sql`EXCLUDED.result` }),
          )
          .execute();
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
          .selectFrom("rpc_request_results")
          .select(["request_hash", "result"])
          .where("request_hash", "in", requestHashes)
          .where("chain_id", "=", String(chainId))
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
        const numbers = blocks.map(({ number }) => String(hexToNumber(number)));

        await database.qb.sync
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", String(chainId))
          .where("block_number", "in", numbers)
          .execute();
      },
    );
  },
  pruneByChain: async ({ chainId }) =>
    database.wrap({ method: "pruneByChain", includeTraceLogs: true }, () =>
      database.qb.sync.transaction().execute(async (tx) => {
        await tx
          .deleteFrom("logs")
          .where("chain_id", "=", String(chainId))
          .execute();
        await tx
          .deleteFrom("blocks")
          .where("chain_id", "=", String(chainId))
          .execute();

        await tx
          .deleteFrom("traces")
          .where("chain_id", "=", String(chainId))
          .execute();
        await tx
          .deleteFrom("transactions")
          .where("chain_id", "=", String(chainId))
          .execute();
        await tx
          .deleteFrom("transaction_receipts")
          .where("chain_id", "=", String(chainId))
          .execute();
        await tx
          .deleteFrom("factory_addresses")
          .where("chain_id", "=", String(chainId))
          .execute();
      }),
    ),
});

const addressFilter = (
  eb:
    | ExpressionBuilder<PonderSyncSchema, "logs">
    | ExpressionBuilder<PonderSyncSchema, "transactions">
    | ExpressionBuilder<PonderSyncSchema, "traces">,
  address:
    | LogFilter["address"]
    | TransactionFilter["fromAddress"]
    | TransactionFilter["toAddress"],
  column: "address" | "from" | "to",
): OperandExpression<SqlBool> => {
  // `factory` filtering is handled in-memory
  if (isAddressFactory(address)) return eb.val(true);
  // @ts-ignore
  if (Array.isArray(address)) return eb(column, "in", address);
  // @ts-ignore
  if (typeof address === "string") return eb(column, "=", address);
  return eb.val(true);
};

const logFilter = (
  eb: ExpressionBuilder<PonderSyncSchema, "logs">,
  filter: LogFilter,
): OperandExpression<SqlBool> => {
  const conditions: OperandExpression<SqlBool>[] = [];

  for (const idx of [0, 1, 2, 3] as const) {
    // If it's an array of length 1, collapse it.
    const raw = filter[`topic${idx}`] ?? null;
    if (raw === null) continue;
    const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
    if (Array.isArray(topic)) {
      conditions.push(eb.or(topic.map((t) => eb(`logs.topic${idx}`, "=", t))));
    } else {
      conditions.push(eb(`logs.topic${idx}`, "=", topic));
    }
  }

  conditions.push(addressFilter(eb, filter.address, "address"));

  if (filter.fromBlock !== undefined) {
    conditions.push(eb("logs.block_number", ">=", String(filter.fromBlock!)));
  }
  if (filter.toBlock !== undefined) {
    conditions.push(eb("logs.block_number", "<=", String(filter.toBlock!)));
  }

  return eb.and(conditions);
};

// @ts-expect-error
const blockFilter = (
  eb: ExpressionBuilder<PonderSyncSchema, "blocks">,
  filter: BlockFilter,
) => {
  const conditions: OperandExpression<SqlBool>[] = [];

  conditions.push(
    sql`(blocks.number - ${filter.offset}) % ${filter.interval} = 0`,
  );

  if (filter.fromBlock !== undefined) {
    conditions.push(eb("blocks.number", ">=", String(filter.fromBlock!)));
  }
  if (filter.toBlock !== undefined) {
    conditions.push(eb("blocks.number", "<=", String(filter.toBlock!)));
  }

  return eb.and(conditions);
};

// @ts-expect-error
const transactionFilter = (
  eb: ExpressionBuilder<PonderSyncSchema, "transactions">,
  filter: TransactionFilter,
) => {
  const conditions: OperandExpression<SqlBool>[] = [];

  conditions.push(addressFilter(eb, filter.fromAddress, "from"));
  conditions.push(addressFilter(eb, filter.toAddress, "to"));

  if (filter.fromBlock !== undefined) {
    conditions.push(
      eb("transactions.block_number", ">=", String(filter.fromBlock!)),
    );
  }
  if (filter.toBlock !== undefined) {
    conditions.push(
      eb("transactions.block_number", "<=", String(filter.toBlock!)),
    );
  }

  return eb.and(conditions);
};

const transferFilter = (
  eb: ExpressionBuilder<PonderSyncSchema, "traces">,
  filter: TransferFilter,
) => {
  const conditions: OperandExpression<SqlBool>[] = [];

  conditions.push(addressFilter(eb, filter.fromAddress, "from"));
  conditions.push(addressFilter(eb, filter.toAddress, "to"));

  if (filter.includeReverted === false) {
    conditions.push(eb("traces.error", "=", null));
  }

  if (filter.fromBlock !== undefined) {
    conditions.push(eb("traces.block_number", ">=", String(filter.fromBlock!)));
  }
  if (filter.toBlock !== undefined) {
    conditions.push(eb("traces.block_number", "<=", String(filter.toBlock!)));
  }

  return eb.and(conditions);
};

const traceFilter = (
  eb: ExpressionBuilder<PonderSyncSchema, "traces">,
  filter: TraceFilter,
) => {
  const conditions: OperandExpression<SqlBool>[] = [];

  conditions.push(addressFilter(eb, filter.fromAddress, "from"));
  conditions.push(addressFilter(eb, filter.toAddress, "to"));

  if (filter.includeReverted === false) {
    conditions.push(eb("traces.error", "=", null));
  }

  if (filter.callType !== undefined) {
    conditions.push(eb("traces.type", "=", filter.callType));
  }

  if (filter.functionSelector !== undefined) {
    if (Array.isArray(filter.functionSelector)) {
      conditions.push(
        eb(
          sql`substring(traces.input from 1 for 10)`,
          "in",
          filter.functionSelector,
        ),
      );
    } else {
      conditions.push(
        eb(
          sql`substring(traces.input from 1 for 10)`,
          "=",
          filter.functionSelector,
        ),
      );
    }
  }

  if (filter.fromBlock !== undefined) {
    conditions.push(eb("traces.block_number", ">=", String(filter.fromBlock!)));
  }
  if (filter.toBlock !== undefined) {
    conditions.push(eb("traces.block_number", "<=", String(filter.toBlock!)));
  }

  return eb.and(conditions);
};
