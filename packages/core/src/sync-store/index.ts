import type { Common } from "@/common/common.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { RawEvent } from "@/sync/events.js";
import { getFragmentIds } from "@/sync/fragments.js";
import {
  type BlockFilter,
  type Factory,
  type Filter,
  type LogFactory,
  type LogFilter,
  type TraceFilter,
  type TransactionFilter,
  type TransferFilter,
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "@/sync/source.js";
import type { Log, Trace } from "@/types/eth.js";
import type {
  LightBlock,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import type { NonNull } from "@/types/utils.js";
import { type Interval, intervalIntersectionMany } from "@/utils/interval.js";
import { type Kysely, type SelectQueryBuilder, sql as ksql, sql } from "kysely";
import type { InsertObject } from "kysely";
import {
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
  checksumAddress,
  hexToBigInt,
} from "viem";
import {
  type BlocksTable,
  type LogsTable,
  type PonderSyncSchema,
  type TracesTable,
  type TransactionReceiptsTable,
  type TransactionsTable,
  encodeBlock,
  encodeLog,
  encodeTrace,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encoding.js";

export type SyncStore = {
  insertIntervals(args: {
    intervals: {
      filter: Filter;
      interval: Interval;
    }[];
  }): Promise<void>;
  getIntervals(args: {
    filters: Filter[];
  }): Promise<Map<Filter, Interval[]>>;
  getChildAddresses(args: {
    filter: Factory;
    limit?: number;
  }): Promise<Address[]>;
  filterChildAddresses(args: {
    filter: Factory;
    addresses: Address[];
  }): Promise<Set<Address>>;
  insertLogs(args: {
    logs: { log: SyncLog; block?: SyncBlock }[];
    shouldUpdateCheckpoint: boolean;
    chainId: number;
  }): Promise<void>;
  insertBlocks(args: { blocks: SyncBlock[]; chainId: number }): Promise<void>;
  /** Return true if the block receipt is present in the database. */
  hasBlock(args: { hash: Hash }): Promise<boolean>;
  insertTransactions(args: {
    transactions: { transaction: SyncTransaction; block: SyncBlock }[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction is present in the database. */
  hasTransaction(args: { hash: Hash }): Promise<boolean>;
  insertTransactionReceipts(args: {
    transactionReceipts: SyncTransactionReceipt[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction receipt is present in the database. */
  hasTransactionReceipt(args: { hash: Hash }): Promise<boolean>;
  insertTraces(args: {
    traces: {
      trace: SyncTrace;
      block: SyncBlock;
      transaction: SyncTransaction;
    }[];
    chainId: number;
  }): Promise<void>;
  /** Returns an ordered list of events based on the `filters` and pagination arguments. */
  getEvents(args: {
    filters: Filter[];
    from: string;
    to: string;
    limit: number;
  }): Promise<{ events: RawEvent[]; cursor: string }>;
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
  pruneByChain(args: {
    fromBlock: number;
    chainId: number;
  }): Promise<void>;
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
    .$call((qb) => {
      if (Array.isArray(factory.address)) {
        return qb.where("address", "in", factory.address);
      }
      return qb.where("address", "=", factory.address);
    })
    .where("topic0", "=", factory.eventSelector)
    .where("chainId", "=", factory.chainId);

export const createSyncStore = ({
  common,
  db,
}: {
  common: Common;
  db: HeadlessKysely<PonderSyncSchema>;
}): SyncStore => ({
  insertIntervals: async ({ intervals }) => {
    if (intervals.length === 0) return;

    await db.wrap({ method: "insertIntervals" }, async () => {
      const values: InsertObject<PonderSyncSchema, "intervals">[] = [];

      // NOTE: In order to force proper range union behavior, `interval[1]` must
      // be rounded up.

      for (const { interval, filter } of intervals) {
        for (const fragment of getFragmentIds(filter)) {
          values.push({
            fragment_id: fragment.id,
            chain_id: filter.chainId,
            blocks: ksql`nummultirange(numrange(${interval[0]}, ${interval[1] + 1}, '[]'))`,
          });
        }
      }

      await db
        .insertInto("intervals")
        .values(values)
        .onConflict((oc) =>
          oc.column("fragment_id").doUpdateSet({
            blocks: ksql`intervals.blocks + excluded.blocks`,
          }),
        )
        .execute();
    });
  },
  getIntervals: async ({ filters }) =>
    db.wrap({ method: "getIntervals" }, async () => {
      let query:
        | SelectQueryBuilder<
            PonderSyncSchema,
            "intervals",
            { merged_blocks: string | null; filter: string }
          >
        | undefined;

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]!;
        const fragments = getFragmentIds(filter);
        for (const fragment of fragments) {
          const _query = db
            .selectFrom(
              db
                .selectFrom("intervals")
                .select(sql`unnest(blocks)`.as("blocks"))
                .where("fragment_id", "in", fragment.adjacent)
                .as("unnested"),
            )
            .select([
              sql<string>`range_agg(unnested.blocks)`.as("merged_blocks"),
              sql<string>`${i}`.as("filter"),
            ]);
          // @ts-ignore
          query = query === undefined ? _query : query.unionAll(_query);
        }
      }

      const rows = await query!.execute();

      const result: Map<Filter, Interval[]> = new Map();

      // intervals use "union" for the same fragment, and
      // "intersection" for the same filter

      // NOTE: `interval[1]` must be rounded down in order to offset the previous
      // rounding.

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i]!;
        const intervals = rows
          .filter((row) => row.filter === `${i}`)
          .map((row) =>
            (row.merged_blocks
              ? (JSON.parse(
                  `[${row.merged_blocks.slice(1, -1)}]`,
                ) as Interval[])
              : []
            ).map((interval) => [interval[0], interval[1] - 1] as Interval),
          );

        result.set(filter, intervalIntersectionMany(intervals));
      }

      return result;
    }),
  getChildAddresses: ({ filter, limit }) =>
    db.wrap({ method: "getChildAddresses" }, async () => {
      return await db
        .selectFrom("logs")
        .$call((qb) => logFactorySQL(qb, filter))
        .orderBy("id asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!))
        .execute()
        .then((addresses) => addresses.map(({ childAddress }) => childAddress));
    }),
  filterChildAddresses: ({ filter, addresses }) =>
    db.wrap({ method: "filterChildAddresses" }, async () => {
      const result = await db
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
    }),
  insertLogs: async ({ logs, shouldUpdateCheckpoint, chainId }) => {
    if (logs.length === 0) return;
    await db.wrap({ method: "insertLogs" }, async () => {
      // Calculate `batchSize` based on how many parameters the
      // input will have
      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters /
          Object.keys(encodeLog({ log: logs[0]!.log, chainId })).length,
      );

      // As an optimization, logs that are matched by a factory do
      // not contain a checkpoint, because not corresponding block is
      // fetched (no block.timestamp). However, when a log is matched by
      // both a log filter and a factory, the checkpoint must be included
      // in the db.

      for (let i = 0; i < logs.length; i += batchSize) {
        await db
          .insertInto("logs")
          .values(
            logs
              .slice(i, i + batchSize)
              .map(({ log, block }) => encodeLog({ log, block, chainId })),
          )
          .onConflict((oc) =>
            oc.column("id").$call((qb) =>
              shouldUpdateCheckpoint
                ? qb.doUpdateSet((eb) => ({
                    checkpoint: eb.ref("excluded.checkpoint"),
                  }))
                : qb.doNothing(),
            ),
          )
          .execute();
      }
    });
  },
  insertBlocks: async ({ blocks, chainId }) => {
    if (blocks.length === 0) return;
    await db.wrap({ method: "insertBlocks" }, async () => {
      // Calculate `batchSize` based on how many parameters the
      // input will have
      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters /
          Object.keys(encodeBlock({ block: blocks[0]!, chainId })).length,
      );

      for (let i = 0; i < blocks.length; i += batchSize) {
        await db
          .insertInto("blocks")
          .values(
            blocks
              .slice(i, i + batchSize)
              .map((block) => encodeBlock({ block, chainId })),
          )
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }
    });
  },
  hasBlock: async ({ hash }) =>
    db.wrap({ method: "hasBlock" }, async () => {
      return await db
        .selectFrom("blocks")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTransactions: async ({ transactions, chainId }) => {
    if (transactions.length === 0) return;
    await db.wrap({ method: "insertTransactions" }, async () => {
      // Calculate `batchSize` based on how many parameters the
      // input will have
      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters /
          Object.keys(
            encodeTransaction({
              transaction: transactions[0]!.transaction,
              block: transactions[0]!.block,
              chainId,
            }),
          ).length,
      );

      // As an optimization for the migration, transactions inserted before 0.8 do not
      // contain a checkpoint. However, for correctness the checkpoint must be inserted
      // for new transactions (using onConflictDoUpdate).

      for (let i = 0; i < transactions.length; i += batchSize) {
        await db
          .insertInto("transactions")
          .values(
            transactions
              .slice(i, i + batchSize)
              .map(({ transaction, block }) =>
                encodeTransaction({ transaction, block, chainId }),
              ),
          )
          .onConflict((oc) =>
            oc.column("hash").doUpdateSet((eb) => ({
              checkpoint: eb.ref("excluded.checkpoint"),
            })),
          )
          .execute();
      }
    });
  },
  hasTransaction: async ({ hash }) =>
    db.wrap({ method: "hasTransaction" }, async () => {
      return await db
        .selectFrom("transactions")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTransactionReceipts: async ({ transactionReceipts, chainId }) => {
    if (transactionReceipts.length === 0) return;
    await db.wrap({ method: "insertTransactionReceipts" }, async () => {
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
        await db
          .insertInto("transactionReceipts")
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
          .onConflict((oc) => oc.column("transactionHash").doNothing())
          .execute();
      }
    });
  },
  hasTransactionReceipt: async ({ hash }) =>
    db.wrap({ method: "hasTransactionReceipt" }, async () => {
      return await db
        .selectFrom("transactionReceipts")
        .select("transactionHash")
        .where("transactionHash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTraces: async ({ traces, chainId }) => {
    if (traces.length === 0) return;
    await db.wrap({ method: "insertTraces" }, async () => {
      // Calculate `batchSize` based on how many parameters the
      // input will have
      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters /
          Object.keys(
            encodeTrace({
              trace: traces[0]!.trace.trace,
              block: traces[0]!.block,
              transaction: traces[0]!.transaction,
              chainId,
            }),
          ).length,
      );

      for (let i = 0; i < traces.length; i += batchSize) {
        await db
          .insertInto("traces")
          .values(
            traces
              .slice(i, i + batchSize)
              .map(({ trace, block, transaction }) =>
                encodeTrace({
                  trace: trace.trace,
                  block,
                  transaction,
                  chainId,
                }),
              ),
          )
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      }
    });
  },
  getEvents: async ({ filters, from, to, limit }) => {
    const addressSQL = (
      qb: SelectQueryBuilder<
        PonderSyncSchema,
        "logs" | "blocks" | "traces" | "transactions",
        {}
      >,
      address: LogFilter["address"],
      column:
        | "address"
        | "transactions.from"
        | "transactions.to"
        | "traces.from"
        | "traces.to",
    ) => {
      if (typeof address === "string") return qb.where(column, "=", address);
      if (isAddressFactory(address)) {
        return qb.where(
          column,
          "in",
          db.selectFrom("logs").$call((qb) => logFactorySQL(qb, address)),
        );
      }
      if (Array.isArray(address)) return qb.where(column, "in", address);

      return qb;
    };

    const blockColumns = [
      "blocks.baseFeePerGas as block_baseFeePerGas",
      "blocks.difficulty as block_difficulty",
      "blocks.extraData as block_extraData",
      "blocks.gasLimit as block_gasLimit",
      "blocks.gasUsed as block_gasUsed",
      "blocks.hash as block_hash",
      "blocks.logsBloom as block_logsBloom",
      "blocks.miner as block_miner",
      "blocks.mixHash as block_mixHash",
      "blocks.nonce as block_nonce",
      "blocks.number as block_number",
      "blocks.parentHash as block_parentHash",
      "blocks.receiptsRoot as block_receiptsRoot",
      "blocks.sha3Uncles as block_sha3Uncles",
      "blocks.size as block_size",
      "blocks.stateRoot as block_stateRoot",
      "blocks.timestamp as block_timestamp",
      "blocks.totalDifficulty as block_totalDifficulty",
      "blocks.transactionsRoot as block_transactionsRoot",
    ];

    const transactionColumns = [
      "transactions.accessList as tx_accessList",
      "transactions.from as tx_from",
      "transactions.gas as tx_gas",
      "transactions.gasPrice as tx_gasPrice",
      "transactions.hash as tx_hash",
      "transactions.input as tx_input",
      "transactions.maxFeePerGas as tx_maxFeePerGas",
      "transactions.maxPriorityFeePerGas as tx_maxPriorityFeePerGas",
      "transactions.nonce as tx_nonce",
      "transactions.r as tx_r",
      "transactions.s as tx_s",
      "transactions.to as tx_to",
      "transactions.transactionIndex as tx_transactionIndex",
      "transactions.type as tx_type",
      "transactions.value as tx_value",
      "transactions.v as tx_v",
    ];
    const transactionColumnsNull = [
      ksql`null`.as("tx_accessList"),
      ksql`null`.as("tx_from"),
      ksql`CAST(null AS numeric(78, 0))`.as("tx_gas"),
      ksql`CAST(null AS numeric(78, 0))`.as("tx_gasPrice"),
      ksql`null`.as("tx_hash"),
      ksql`null`.as("tx_input"),
      ksql`CAST(null AS numeric(78, 0))`.as("tx_maxFeePerGas"),
      ksql`CAST(null AS numeric(78, 0))`.as("tx_maxPriorityFeePerGas"),
      ksql`CAST(null AS int4)`.as("tx_nonce"),
      ksql`null`.as("tx_r"),
      ksql`null`.as("tx_s"),
      ksql`null`.as("tx_to"),
      ksql`CAST(null AS int4)`.as("tx_transactionIndex"),
      ksql`null`.as("tx_type"),
      ksql`CAST(null AS numeric(78, 0))`.as("tx_value"),
      ksql`CAST(null AS numeric(78, 0))`.as("tx_v"),
    ];

    const logsColumns = [
      "logs.address as log_address",
      "logs.data as log_data",
      "logs.id as log_id",
      "logs.logIndex as log_logIndex",
      "logs.topic0 as log_topic0",
      "logs.topic1 as log_topic1",
      "logs.topic2 as log_topic2",
      "logs.topic3 as log_topic3",
    ];
    const logsColumnsNull = [
      ksql`null`.as("log_address"),
      ksql`null`.as("log_data"),
      ksql`null`.as("log_id"),
      ksql`CAST(null AS int4)`.as("log_logIndex"),
      ksql`null`.as("log_topic0"),
      ksql`null`.as("log_topic1"),
      ksql`null`.as("log_topic2"),
      ksql`null`.as("log_topic3"),
    ];

    const traceColumns = [
      "traces.id as trace_id",
      "traces.type as trace_callType",
      "traces.from as trace_from",
      "traces.to as trace_to",
      "traces.gas as trace_gas",
      "traces.gasUsed as trace_gasUsed",
      "traces.input as trace_input",
      "traces.output as trace_output",
      "traces.error as trace_error",
      "traces.revertReason as trace_revertReason",
      "traces.value as trace_value",
      "traces.index as trace_index",
      "traces.subcalls as trace_subcalls",
    ];
    const traceColumnsNull = [
      ksql`null`.as("trace_id"),
      ksql`null`.as("trace_callType"),
      ksql`null`.as("trace_from"),
      ksql`null`.as("trace_to"),
      ksql`CAST(null AS numeric(78, 0))`.as("trace_gas"),
      ksql`CAST(null AS numeric(78, 0))`.as("trace_gasUsed"),
      ksql`null`.as("trace_input"),
      ksql`null`.as("trace_output"),
      ksql`null`.as("trace_error"),
      ksql`null`.as("trace_revertReason"),
      ksql`CAST(null AS numeric(78, 0))`.as("trace_value"),
      ksql`CAST(null AS int4)`.as("trace_index"),
      ksql`CAST(null AS int4)`.as("trace_subcalls"),
    ];

    const txReceiptColumns = [
      "transactionReceipts.contractAddress as txr_contractAddress",
      "transactionReceipts.cumulativeGasUsed as txr_cumulativeGasUsed",
      "transactionReceipts.effectiveGasPrice as txr_effectiveGasPrice",
      "transactionReceipts.from as txr_from",
      "transactionReceipts.gasUsed as txr_gasUsed",
      "transactionReceipts.logsBloom as txr_logsBloom",
      "transactionReceipts.status as txr_status",
      "transactionReceipts.to as txr_to",
      "transactionReceipts.type as txr_type",
    ];
    const txReceiptColumnsNull = [
      ksql`null`.as("txr_contractAddress"),
      ksql`CAST(null AS numeric(78, 0))`.as("txr_cumulativeGasUsed"),
      ksql`CAST(null AS numeric(78, 0))`.as("txr_effectiveGasPrice"),
      ksql`null`.as("txr_from"),
      ksql`CAST(null AS numeric(78, 0))`.as("txr_gasUsed"),
      ksql`null`.as("txr_logsBloom"),
      ksql`null`.as("txr_status"),
      ksql`null`.as("txr_to"),
      ksql`null`.as("txr_type"),
    ];

    const logSQL = (
      filter: LogFilter,
      db: Kysely<PonderSyncSchema>,
      index: number,
    ) =>
      db
        .selectFrom("logs")
        .select([
          ksql.raw(`'${index}'`).as("filterIndex"),
          "logs.checkpoint as checkpoint",
          "logs.chainId as chainId",
          "logs.blockHash as blockHash",
          "logs.transactionHash as transactionHash",
          "logs.id as logId",
          ksql`null`.as("traceId"),
        ])
        .where("logs.chainId", "=", filter.chainId)
        .$call((qb) => {
          for (const idx of [0, 1, 2, 3] as const) {
            // If it's an array of length 1, collapse it.
            const raw = filter[`topic${idx}`] ?? null;
            if (raw === null) continue;
            const topic =
              Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
            if (Array.isArray(topic)) {
              qb = qb.where((eb) =>
                eb.or(topic.map((t) => eb(`logs.topic${idx}`, "=", t))),
              );
            } else {
              qb = qb.where(`logs.topic${idx}`, "=", topic);
            }
          }
          return qb;
        })
        .$call((qb) => addressSQL(qb as any, filter.address, "address"))
        .$if(filter.fromBlock !== undefined, (qb) =>
          qb.where("logs.blockNumber", ">=", filter.fromBlock!.toString()),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("logs.blockNumber", "<=", filter.toBlock!.toString()),
        )
        .innerJoin("blocks", "blocks.hash", "blockHash")
        .leftJoin("transactions", "transactions.hash", "logs.transactionHash")
        // @ts-ignore
        .select([
          ...blockColumns,
          ...transactionColumns,
          ...logsColumns,
          ...traceColumnsNull,
        ])
        .$call((qb) =>
          shouldGetTransactionReceipt(filter)
            ? qb
                .leftJoin(
                  "transactionReceipts",
                  "transactionReceipts.transactionHash",
                  "logs.transactionHash",
                ) // @ts-ignore
                .select(txReceiptColumns)
            : qb.select(txReceiptColumnsNull),
        );

    const blockSQL = (
      filter: BlockFilter,
      db: Kysely<PonderSyncSchema>,
      index: number,
    ) =>
      db
        .selectFrom("blocks")
        .select([
          ksql.raw(`'${index}'`).as("filterIndex"),
          "blocks.checkpoint as checkpoint",
          "blocks.chainId as chainId",
          "blocks.hash as blockHash",
          ksql`null`.as("transactionHash"),
          ksql`null`.as("logId"),
          ksql`null`.as("traceId"),
        ])
        .where("blocks.chainId", "=", filter.chainId)
        .$if(filter !== undefined && filter.interval !== undefined, (qb) =>
          qb.where(
            ksql`(blocks.number - ${filter.offset}) % ${filter.interval} = 0`,
          ),
        )
        .$if(filter.fromBlock !== undefined, (qb) =>
          qb.where("blocks.number", ">=", filter.fromBlock!.toString()),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("blocks.number", "<=", filter.toBlock!.toString()),
        ) // @ts-ignore
        .select([
          ...blockColumns,
          ...transactionColumnsNull,
          ...logsColumnsNull,
          ...traceColumnsNull,
          ...txReceiptColumnsNull,
        ]);

    const transactionSQL = (
      filter: TransactionFilter,
      db: Kysely<PonderSyncSchema>,
      index: number,
    ) =>
      db
        .selectFrom("transactions")
        .select([
          ksql.raw(`'${index}'`).as("filterIndex"),
          "transactions.checkpoint as checkpoint",
          "transactions.chainId as chainId",
          "transactions.blockHash as blockHash",
          "transactions.hash as transactionHash",
          ksql`null`.as("logId"),
          ksql`null`.as("traceId"),
        ])
        .where("transactions.chainId", "=", filter.chainId)
        .$call((qb) =>
          addressSQL(qb as any, filter.fromAddress, "transactions.from"),
        )
        .$call((qb) =>
          addressSQL(qb as any, filter.toAddress, "transactions.to"),
        )
        .$if(filter.includeReverted === false, (qb) =>
          qb.where(
            db
              .selectFrom("transactionReceipts")
              .select("status")
              .where(
                "transactionReceipts.transactionHash",
                "=",
                sql.ref("transactions.hash"),
              ),
            "=",
            "0x1",
          ),
        )
        .$if(filter.fromBlock !== undefined, (qb) =>
          qb.where(
            "transactions.blockNumber",
            ">=",
            filter.fromBlock!.toString(),
          ),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where(
            "transactions.blockNumber",
            "<=",
            filter.toBlock!.toString(),
          ),
        )
        .innerJoin("blocks", "blocks.hash", "transactions.blockHash")
        // @ts-ignore
        .select([
          ...blockColumns,
          ...transactionColumns,
          ...logsColumnsNull,
          ...traceColumnsNull,
        ])
        .$call((qb) =>
          shouldGetTransactionReceipt(filter)
            ? qb
                .leftJoin(
                  "transactionReceipts",
                  "transactionReceipts.transactionHash",
                  "transactions.hash",
                ) // @ts-ignore
                .select(txReceiptColumns)
            : qb.select(txReceiptColumnsNull),
        );

    const transferSQL = (
      filter: TransferFilter,
      db: Kysely<PonderSyncSchema>,
      index: number,
    ) =>
      db
        .selectFrom("traces")
        .select([
          ksql.raw(`'${index}'`).as("filterIndex"),
          "traces.checkpoint as checkpoint",
          "traces.chainId as chainId",
          "traces.blockHash as blockHash",
          "traces.transactionHash as transactionHash",
          ksql`null`.as("logId"),
          "traces.id as traceId",
        ])
        .where("traces.chainId", "=", filter.chainId)
        .$call((qb) => addressSQL(qb as any, filter.fromAddress, "traces.from"))
        .$call((qb) => addressSQL(qb as any, filter.toAddress, "traces.to"))
        .where("traces.value", ">", "0")
        .$if(filter.includeReverted === false, (qb) =>
          qb.where("traces.isReverted", "=", 0),
        )
        .$if(filter.fromBlock !== undefined, (qb) =>
          qb.where("traces.blockNumber", ">=", filter.fromBlock!.toString()),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("traces.blockNumber", "<=", filter.toBlock!.toString()),
        )
        .innerJoin("blocks", "blocks.hash", "traces.blockHash")
        .leftJoin("transactions", "transactions.hash", "traces.transactionHash")
        // @ts-ignore
        .select([
          ...blockColumns,
          ...transactionColumns,
          ...logsColumnsNull,
          ...traceColumns,
        ])
        .$call((qb) =>
          shouldGetTransactionReceipt(filter)
            ? qb
                .leftJoin(
                  "transactionReceipts",
                  "transactionReceipts.transactionHash",
                  "traces.transactionHash",
                ) // @ts-ignore
                .select(txReceiptColumns)
            : qb.select(txReceiptColumnsNull),
        );

    const traceSQL = (
      filter: TraceFilter,
      db: Kysely<PonderSyncSchema>,
      index: number,
    ) =>
      db
        .selectFrom("traces")
        .select([
          ksql.raw(`'${index}'`).as("filterIndex"),
          "traces.checkpoint as checkpoint",
          "traces.chainId as chainId",
          "traces.blockHash as blockHash",
          "traces.transactionHash as transactionHash",
          ksql`null`.as("logId"),
          "traces.id as traceId",
        ])
        .where("traces.chainId", "=", filter.chainId)
        .$call((qb) => addressSQL(qb as any, filter.fromAddress, "traces.from"))
        .$call((qb) => addressSQL(qb as any, filter.toAddress, "traces.to"))
        .$if(filter.includeReverted === false, (qb) =>
          qb.where("traces.isReverted", "=", 0),
        )
        .$if(filter.callType !== undefined, (qb) =>
          qb.where("traces.type", "=", filter.callType!),
        )
        .$if(filter.functionSelector !== undefined, (qb) => {
          if (Array.isArray(filter.functionSelector)) {
            return qb.where("functionSelector", "in", filter.functionSelector!);
          } else {
            return qb.where("functionSelector", "=", filter.functionSelector!);
          }
        })
        .$if(filter.fromBlock !== undefined, (qb) =>
          qb.where("traces.blockNumber", ">=", filter.fromBlock!.toString()),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("traces.blockNumber", "<=", filter.toBlock!.toString()),
        )
        .innerJoin("blocks", "blocks.hash", "traces.blockHash")
        .leftJoin("transactions", "transactions.hash", "traces.transactionHash")
        // @ts-ignore
        .select([
          ...blockColumns,
          ...transactionColumns,
          ...logsColumnsNull,
          ...traceColumns,
        ])
        .$call((qb) =>
          shouldGetTransactionReceipt(filter)
            ? qb
                .leftJoin(
                  "transactionReceipts",
                  "transactionReceipts.transactionHash",
                  "traces.transactionHash",
                ) // @ts-ignore
                .select(txReceiptColumns)
            : qb.select(txReceiptColumnsNull),
        );

    const rows = await db.wrap(
      {
        method: "getEvents",
        shouldRetry(error) {
          return error.message.includes("statement timeout") === false;
        },
      },
      async () => {
        let query:
          | SelectQueryBuilder<
              PonderSyncSchema,
              "logs" | "blocks" | "traces" | "transactions",
              {
                filterIndex: number;
                checkpoint: string;
                chainId: number;
                logId: string;
                blockHash: string;
                transactionHash: string;
                traceId: string;
                block_baseFeePerGas: BlocksTable["baseFeePerGas"];
                block_difficulty: BlocksTable["difficulty"];
                block_extraData: BlocksTable["extraData"];
                block_gasLimit: BlocksTable["gasLimit"];
                block_gasUsed: BlocksTable["gasUsed"];
                block_hash: BlocksTable["hash"];
                block_logsBloom: BlocksTable["logsBloom"];
                block_miner: BlocksTable["miner"];
                block_mixHash: BlocksTable["mixHash"];
                block_nonce: BlocksTable["nonce"];
                block_number: BlocksTable["number"];
                block_parentHash: BlocksTable["parentHash"];
                block_receiptsRoot: BlocksTable["receiptsRoot"];
                block_sha3Uncles: BlocksTable["sha3Uncles"];
                block_size: BlocksTable["size"];
                block_stateRoot: BlocksTable["stateRoot"];
                block_timestamp: BlocksTable["timestamp"];
                block_totalDifficulty: BlocksTable["totalDifficulty"];
                block_transactionsRoot: BlocksTable["transactionsRoot"];
                log_address: LogsTable["address"];
                log_data: LogsTable["data"];
                log_id: LogsTable["id"];
                log_logIndex: LogsTable["logIndex"];
                log_topic0: LogsTable["topic0"];
                log_topic1: LogsTable["topic1"];
                log_topic2: LogsTable["topic2"];
                log_topic3: LogsTable["topic3"];
                tx_accessList: TransactionsTable["accessList"];
                tx_from: TransactionsTable["from"];
                tx_gas: TransactionsTable["gas"];
                tx_gasPrice: TransactionsTable["gasPrice"];
                tx_hash: TransactionsTable["hash"];
                tx_input: TransactionsTable["input"];
                tx_maxFeePerGas: TransactionsTable["maxFeePerGas"];
                tx_maxPriorityFeePerGas: TransactionsTable["maxPriorityFeePerGas"];
                tx_nonce: TransactionsTable["nonce"];
                tx_r: TransactionsTable["r"];
                tx_s: TransactionsTable["s"];
                tx_to: TransactionsTable["to"];
                tx_transactionIndex: TransactionsTable["transactionIndex"];
                tx_type: TransactionsTable["type"];
                tx_value: TransactionsTable["value"];
                tx_v: TransactionsTable["v"];
                trace_id: TracesTable["id"];
                trace_callType: TracesTable["type"];
                trace_from: TracesTable["from"];
                trace_to: TracesTable["to"];
                trace_gas: TracesTable["gas"];
                trace_gasUsed: TracesTable["gasUsed"];
                trace_input: TracesTable["input"];
                trace_output: TracesTable["output"];
                trace_value: TracesTable["value"];
                trace_index: TracesTable["index"];
                trace_subcalls: TracesTable["subcalls"];
                trace_error: TracesTable["error"];
                trace_revertReason: TracesTable["revertReason"];
                txr_contractAddress: TransactionReceiptsTable["contractAddress"];
                txr_cumulativeGasUsed: TransactionReceiptsTable["cumulativeGasUsed"];
                txr_effectiveGasPrice: TransactionReceiptsTable["effectiveGasPrice"];
                txr_from: TransactionReceiptsTable["from"];
                txr_gasUsed: TransactionReceiptsTable["gasUsed"];
                txr_logsBloom: TransactionReceiptsTable["logsBloom"];
                txr_status: TransactionReceiptsTable["status"];
                txr_to: TransactionReceiptsTable["to"];
                txr_type: TransactionReceiptsTable["type"];
              }
            >
          | undefined;

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i]!;

          const _query =
            filter.type === "log"
              ? logSQL(filter, db, i)
              : filter.type === "block"
                ? blockSQL(filter, db, i)
                : filter.type === "transaction"
                  ? transactionSQL(filter, db, i)
                  : filter.type === "transfer"
                    ? transferSQL(filter, db, i)
                    : traceSQL(filter, db, i);

          // @ts-ignore
          query = query === undefined ? _query : query.unionAll(_query);
        }

        return await db
          .with("event", () => query!)
          .selectFrom("event")
          .select([
            "event.filterIndex as event_filterIndex",
            "event.checkpoint as event_checkpoint",
          ])
          .select([
            "event.block_hash as block_hash",
            "event.block_baseFeePerGas as block_baseFeePerGas",
            "event.block_difficulty as block_difficulty",
            "event.block_extraData as block_extraData",
            "event.block_gasLimit as block_gasLimit",
            "event.block_gasUsed as block_gasUsed",
            "event.block_logsBloom as block_logsBloom",
            "event.block_miner as block_miner",
            "event.block_mixHash as block_mixHash",
            "event.block_nonce as block_nonce",
            "event.block_number as block_number",
            "event.block_parentHash as block_parentHash",
            "event.block_receiptsRoot as block_receiptsRoot",
            "event.block_sha3Uncles as block_sha3Uncles",
            "event.block_size as block_size",
            "event.block_stateRoot as block_stateRoot",
            "event.block_timestamp as block_timestamp",
            "event.block_totalDifficulty as block_totalDifficulty",
            "event.block_transactionsRoot as block_transactionsRoot",
            "event.log_address as log_address",
            "event.log_data as log_data",
            "event.log_id as log_id",
            "event.log_logIndex as log_logIndex",
            "event.log_topic0 as log_topic0",
            "event.log_topic1 as log_topic1",
            "event.log_topic2 as log_topic2",
            "event.log_topic3 as log_topic3",
            "event.tx_hash as tx_hash",
            "event.tx_from as tx_from",
            "event.tx_to as tx_to",
            "event.tx_gas as tx_gas",
            "event.tx_gasPrice as tx_gasPrice",
            "event.tx_input as tx_input",
            "event.tx_maxFeePerGas as tx_maxFeePerGas",
            "event.tx_maxPriorityFeePerGas as tx_maxPriorityFeePerGas",
            "event.tx_nonce as tx_nonce",
            "event.tx_r as tx_r",
            "event.tx_s as tx_s",
            "event.tx_transactionIndex as tx_transactionIndex",
            "event.tx_type as tx_type",
            "event.tx_value as tx_value",
            "event.tx_v as tx_v",
            "event.tx_accessList as tx_accessList",
            "event.trace_id as trace_id",
            "event.trace_callType as trace_callType",
            "event.trace_from as trace_from",
            "event.trace_to as trace_to",
            "event.trace_gas as trace_gas",
            "event.trace_gasUsed as trace_gasUsed",
            "event.trace_input as trace_input",
            "event.trace_output as trace_output",
            "event.trace_value as trace_value",
            "event.trace_index as trace_index",
            "event.trace_subcalls as trace_subcalls",
            "event.trace_error as trace_error",
            "event.trace_revertReason as trace_revertReason",
            "event.txr_contractAddress as txr_contractAddress",
            "event.txr_cumulativeGasUsed as txr_cumulativeGasUsed",
            "event.txr_effectiveGasPrice as txr_effectiveGasPrice",
            "event.txr_from as txr_from",
            "event.txr_gasUsed as txr_gasUsed",
            "event.txr_logsBloom as txr_logsBloom",
            "event.txr_status as txr_status",
            "event.txr_to as txr_to",
            "event.txr_type as txr_type",
          ])
          .where("event.checkpoint", ">", from)
          .where("event.checkpoint", "<=", to)
          .orderBy("event.checkpoint", "asc")
          .orderBy("event.filterIndex", "asc")
          .limit(limit)
          .execute();
      },
    );

    const events = rows.map((_row) => {
      // Without this cast, the block_ and tx_ fields are all nullable
      // which makes this very annoying. Should probably add a runtime check
      // that those fields are indeed present before continuing here.
      const row = _row as NonNull<(typeof rows)[number]>;

      const filter = filters[row.event_filterIndex]!;

      const hasLog = row.log_id !== null;
      const hasTransaction = row.tx_hash !== null;
      const hasTrace = row.trace_id !== null;
      const hasTransactionReceipt = shouldGetTransactionReceipt(filter);

      return {
        chainId: filter.chainId,
        sourceIndex: Number(row.event_filterIndex),
        checkpoint: row.event_checkpoint,
        block: {
          baseFeePerGas:
            row.block_baseFeePerGas !== null
              ? BigInt(row.block_baseFeePerGas)
              : null,
          difficulty: BigInt(row.block_difficulty),
          extraData: row.block_extraData,
          gasLimit: BigInt(row.block_gasLimit),
          gasUsed: BigInt(row.block_gasUsed),
          hash: row.block_hash,
          logsBloom: row.block_logsBloom,
          miner: checksumAddress(row.block_miner),
          mixHash: row.block_mixHash,
          nonce: row.block_nonce,
          number: BigInt(row.block_number),
          parentHash: row.block_parentHash,
          receiptsRoot: row.block_receiptsRoot,
          sha3Uncles: row.block_sha3Uncles,
          size: BigInt(row.block_size),
          stateRoot: row.block_stateRoot,
          timestamp: BigInt(row.block_timestamp),
          totalDifficulty:
            row.block_totalDifficulty !== null
              ? BigInt(row.block_totalDifficulty)
              : null,
          transactionsRoot: row.block_transactionsRoot,
        },
        log: hasLog
          ? {
              address: checksumAddress(row.log_address!),
              data: row.log_data,
              id: row.log_id as Log["id"],
              logIndex: Number(row.log_logIndex),
              removed: false,
              topics: [
                row.log_topic0,
                row.log_topic1,
                row.log_topic2,
                row.log_topic3,
              ].filter((t): t is Hex => t !== null) as [Hex, ...Hex[]] | [],
            }
          : undefined,
        transaction: hasTransaction
          ? {
              from: checksumAddress(row.tx_from),
              gas: BigInt(row.tx_gas),
              hash: row.tx_hash,
              input: row.tx_input,
              nonce: Number(row.tx_nonce),
              r: row.tx_r,
              s: row.tx_s,
              to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
              transactionIndex: Number(row.tx_transactionIndex),
              value: BigInt(row.tx_value),
              v: row.tx_v !== null ? BigInt(row.tx_v) : null,
              ...(row.tx_type === "0x0"
                ? {
                    type: "legacy",
                    gasPrice: BigInt(row.tx_gasPrice),
                  }
                : row.tx_type === "0x1"
                  ? {
                      type: "eip2930",
                      gasPrice: BigInt(row.tx_gasPrice),
                      accessList: JSON.parse(row.tx_accessList),
                    }
                  : row.tx_type === "0x2"
                    ? {
                        type: "eip1559",
                        maxFeePerGas: BigInt(row.tx_maxFeePerGas),
                        maxPriorityFeePerGas: BigInt(
                          row.tx_maxPriorityFeePerGas,
                        ),
                      }
                    : row.tx_type === "0x7e"
                      ? {
                          type: "deposit",
                          maxFeePerGas:
                            row.tx_maxFeePerGas !== null
                              ? BigInt(row.tx_maxFeePerGas)
                              : undefined,
                          maxPriorityFeePerGas:
                            row.tx_maxPriorityFeePerGas !== null
                              ? BigInt(row.tx_maxPriorityFeePerGas)
                              : undefined,
                        }
                      : {
                          type: row.tx_type,
                        }),
            }
          : undefined,
        trace: hasTrace
          ? {
              id: row.trace_id,
              type: row.trace_callType as Trace["type"],
              from: checksumAddress(row.trace_from),
              to: checksumAddress(row.trace_to),
              gas: BigInt(row.trace_gas),
              gasUsed: BigInt(row.trace_gasUsed),
              input: row.trace_input,
              output: row.trace_output,
              value: BigInt(row.trace_value),
              traceIndex: Number(row.trace_index),
              subcalls: Number(row.trace_subcalls),
            }
          : undefined,
        transactionReceipt: hasTransactionReceipt
          ? {
              contractAddress: row.txr_contractAddress
                ? checksumAddress(row.txr_contractAddress)
                : null,
              cumulativeGasUsed: BigInt(row.txr_cumulativeGasUsed),
              effectiveGasPrice: BigInt(row.txr_effectiveGasPrice),
              from: checksumAddress(row.txr_from),
              gasUsed: BigInt(row.txr_gasUsed),
              logsBloom: row.txr_logsBloom,
              status:
                row.txr_status === "0x1"
                  ? "success"
                  : row.txr_status === "0x0"
                    ? "reverted"
                    : (row.txr_status as TransactionReceipt["status"]),
              to: row.txr_to ? checksumAddress(row.txr_to) : null,
              type:
                row.txr_type === "0x0"
                  ? "legacy"
                  : row.txr_type === "0x1"
                    ? "eip2930"
                    : row.tx_type === "0x2"
                      ? "eip1559"
                      : row.tx_type === "0x7e"
                        ? "deposit"
                        : row.tx_type,
            }
          : undefined,
      } satisfies RawEvent;
    });

    let cursor: string;
    if (events.length !== limit) {
      cursor = to;
    } else {
      cursor = events[events.length - 1]!.checkpoint!;
    }

    return { events, cursor };
  },
  insertRpcRequestResult: async ({ request, blockNumber, chainId, result }) =>
    db.wrap({ method: "insertRpcRequestResult" }, async () => {
      await db
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
    }),
  getRpcRequestResult: async ({ request, chainId }) =>
    db.wrap({ method: "getRpcRequestResult" }, async () => {
      const result = await db
        .selectFrom("rpc_request_results")
        .select("result")

        .where("request_hash", "=", sql`MD5(${request})`)
        .where("chain_id", "=", chainId)
        .executeTakeFirst();

      return result?.result;
    }),
  pruneRpcRequestResult: async ({ blocks, chainId }) =>
    db.wrap({ method: "pruneRpcRequestResult" }, async () => {
      if (blocks.length === 0) return;

      const numbers = blocks.map(({ number }) =>
        hexToBigInt(number).toString(),
      );

      await db
        .deleteFrom("rpc_request_results")
        .where("chain_id", "=", chainId)
        .where("block_number", "in", numbers)
        .execute();
    }),
  pruneByChain: async ({ fromBlock, chainId }) =>
    db.wrap({ method: "pruneByChain" }, () =>
      db.transaction().execute(async (tx) => {
        await tx
          .deleteFrom("logs")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("blocks")
          .where("chainId", "=", chainId)
          .where("number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("traces")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("transactions")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("transactionReceipts")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
      }),
    ),
});
