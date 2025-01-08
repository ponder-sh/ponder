import type { Common } from "@/common/common.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { RawEvent } from "@/sync/events.js";
import { type FragmentId, getFragmentIds } from "@/sync/fragments.js";
import {
  type BlockFilter,
  type Factory,
  type Filter,
  type LogFilter,
  type TraceFilter,
  type TransactionFilter,
  type TransferFilter,
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "@/sync/source.js";
import type { Trace } from "@/types/eth.js";
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
import {
  type QueryCreator,
  type SelectQueryBuilder,
  sql as ksql,
} from "kysely";
import type { InsertObject } from "kysely";
import {
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
  checksumAddress,
  hexToBigInt,
  numberToHex,
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
    intervals: {
      filter: Filter;
      interval: Interval;
    }[];
    chainId: number;
  }): Promise<void>;
  getIntervals(args: {
    filters: Filter[];
  }): Promise<Map<Filter, Interval[]>>;
  insertChildAddresses(args: {
    factory: Factory;
    data: { address: Address; blockNumber: bigint }[];
  }): Promise<void>;
  getChildAddresses(args: {
    factory: Factory;
    limit?: number;
  }): Promise<Address[]>;
  filterChildAddresses(args: {
    factory: Factory;
    addresses: Address[];
  }): Promise<Set<Address>>;
  insertLogs(args: {
    logs: { log: SyncLog; block: SyncBlock }[];
    chainId: number;
  }): Promise<void>;
  insertBlocks(args: { blocks: SyncBlock[]; chainId: number }): Promise<void>;
  /** Return true if the block receipt is present in the database. */
  hasBlock(args: { hash: Hash; chainId: number }): Promise<boolean>;
  insertTransactions(args: {
    transactions: { transaction: SyncTransaction; block: SyncBlock }[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction is present in the database. */
  hasTransaction(args: { hash: Hash; chainId: number }): Promise<boolean>;
  insertTransactionReceipts(args: {
    transactionReceipts: SyncTransactionReceipt[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction receipt is present in the database. */
  hasTransactionReceipt(args: {
    hash: Hash;
    chainId: number;
  }): Promise<boolean>;
  insertTraces(args: {
    traces: {
      trace: SyncTrace;
      block: SyncBlock;
      transaction: SyncTransaction;
    }[];
    chainId: number;
  }): Promise<void>;
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
  /** Returns an ordered list of events based on the `filters` and pagination arguments. */
  getEvents(args: {
    filters: Filter[];
    from: string;
    to: string;
    limit: number;
  }): Promise<{ events: RawEvent[]; cursor: string }>;
};

export const createSyncStore = ({
  common,
  db,
}: {
  common: Common;
  db: HeadlessKysely<PonderSyncSchema>;
}): SyncStore => ({
  insertIntervals: async ({ intervals, chainId }) => {
    if (intervals.length === 0) return;

    await db.wrap({ method: "insertIntervals" }, async () => {
      const perFragmentIntervals = new Map<FragmentId, Interval[]>();
      const values: InsertObject<PonderSyncSchema, "intervals">[] = [];

      // dedupe and merge matching fragments

      for (const { filter, interval } of intervals) {
        for (const fragment of getFragmentIds(filter)) {
          if (perFragmentIntervals.has(fragment.id) === false) {
            perFragmentIntervals.set(fragment.id, []);
          }

          perFragmentIntervals.get(fragment.id)!.push(interval);
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
                .select(ksql`unnest(blocks)`.as("blocks"))
                .where("fragment_id", "in", fragment.adjacent)
                .as("unnested"),
            )
            .select([
              ksql<string>`range_agg(unnested.blocks)`.as("merged_blocks"),
              ksql.raw(`'${i}'`).as("filter"),
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
  insertChildAddresses: async ({ factory, data }) =>
    db.wrap({ method: "insertChildAddresses" }, async () => {
      if (data.length === 0) return;

      const chainId = factory.chainId;
      const factoryId = `${factory.address}_${factory.eventSelector}_${factory.childAddressLocation}`;

      await db
        .with("factory_insert", (db) =>
          db
            .insertInto(`factory_${chainId}`)
            .values({ factory_id: factoryId })
            .onConflict((oc) =>
              oc.column("factory_id").doUpdateSet({ factory_id: factoryId }),
            )
            .returning("integer_id"),
        )
        .insertInto(`factory_address_${chainId}`)
        .values(
          data.map(({ address, blockNumber }) => ({
            factory_integer_id: ksql`(SELECT integer_id FROM factory_insert)`,
            address: address.toLowerCase(),
            block_number: blockNumber,
          })),
        )
        .execute();
    }),
  getChildAddresses: ({ factory, limit }) =>
    db.wrap({ method: "getChildAddresses" }, async () => {
      const chainId = factory.chainId;
      const factoryId = `${factory.address}_${factory.eventSelector}_${factory.childAddressLocation}`;

      const rows = await db
        .with("factory_insert", (db) =>
          db
            .insertInto(`factory_${chainId}`)
            .values({ factory_id: factoryId })
            .onConflict((oc) =>
              oc.column("factory_id").doUpdateSet({ factory_id: factoryId }),
            )
            .returning("integer_id"),
        )
        .selectFrom(`factory_address_${chainId}`)
        .select(["address"])
        .where(
          ksql.ref(`factory_address_${chainId}.factory_integer_id`),
          "=",
          ksql`(SELECT integer_id FROM factory_insert)`,
        )
        .orderBy("address asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!))
        .execute();

      return rows.map(({ address }) => address as Address);
    }),
  filterChildAddresses: ({ factory, addresses }) =>
    db.wrap({ method: "filterChildAddresses" }, async () => {
      const chainId = factory.chainId;
      const factoryId = `${factory.address}_${factory.eventSelector}_${factory.childAddressLocation}`;

      const result = await db
        .with("factory_insert", (db) =>
          db
            .insertInto(`factory_${chainId}`)
            .values({ factory_id: factoryId })
            .onConflict((oc) =>
              oc.column("factory_id").doUpdateSet({ factory_id: factoryId }),
            )
            .returning("integer_id"),
        )
        .with("child_address", (db) =>
          db
            .selectFrom(`factory_address_${chainId}`)
            .select(["address"])
            .where(
              ksql.ref(`factory_address_${chainId}.factory_integer_id`),
              "=",
              ksql`(SELECT integer_id FROM factory_insert)`,
            ),
        )
        .with(
          "filter_address(address)",
          () =>
            ksql`( values ${ksql.join(addresses.map((a) => ksql`( ${ksql.val(a)} )`))} )`,
        )
        .selectFrom("filter_address")
        .where(
          "filter_address.address",
          "in",
          ksql`(SELECT address FROM child_address)`,
        )
        .selectAll()
        .execute();

      return new Set<Address>([...result.map(({ address }) => address)]);
    }),
  insertLogs: async ({ logs, chainId }) => {
    if (logs.length === 0) return;
    await db.wrap({ method: "insertLogs" }, async () => {
      // Calculate `batchSize` based on how many parameters the
      // input will have
      const batchSize = Math.floor(
        common.options.databaseMaxQueryParameters /
          Object.keys(
            encodeLog({ log: logs[0]!.log, block: logs[0]!.block, chainId }),
          ).length,
      );

      for (let i = 0; i < logs.length; i += batchSize) {
        await db
          .insertInto(`log_${chainId}`)
          .values(
            logs
              .slice(i, i + batchSize)
              .map(({ log, block }) => encodeLog({ log, block, chainId })),
          )
          .onConflict((oc) => oc.column("checkpoint").doNothing())
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
          .insertInto(`block_${chainId}`)
          .values(
            blocks
              .slice(i, i + batchSize)
              .map((block) => encodeBlock({ block, chainId })),
          )
          .onConflict((oc) => oc.column("checkpoint").doNothing())
          .execute();
      }
    });
  },
  hasBlock: async ({ hash, chainId }) =>
    db.wrap({ method: "hasBlock" }, async () => {
      return await db
        .selectFrom(`block_${chainId}`)
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
          .insertInto(`transaction_${chainId}`)
          .values(
            transactions
              .slice(i, i + batchSize)
              .map(({ transaction, block }) =>
                encodeTransaction({ transaction, block, chainId }),
              ),
          )
          .onConflict((oc) => oc.column("checkpoint").doNothing())
          .execute();
      }
    });
  },
  hasTransaction: async ({ hash, chainId }) =>
    db.wrap({ method: "hasTransaction" }, async () => {
      return await db
        .selectFrom(`transaction_${chainId}`)
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
          .insertInto(`transaction_receipt_${chainId}`)
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
            oc.columns(["block_number", "transaction_index"]).doNothing(),
          )
          .execute();
      }
    });
  },
  hasTransactionReceipt: async ({ hash, chainId }) =>
    db.wrap({ method: "hasTransactionReceipt" }, async () => {
      return await db
        .selectFrom(`transaction_receipt_${chainId}`)
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
          .insertInto(`trace_${chainId}`)
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
          .onConflict((oc) => oc.column("checkpoint").doNothing())
          .execute();
      }
    });
  },
  insertRpcRequestResult: async ({ request, blockNumber, chainId, result }) =>
    db.wrap({ method: "insertRpcRequestResult" }, async () => {
      await db
        .insertInto(`rpc_request_${chainId}`)
        .values({
          request,
          block_number: blockNumber,
          chain_id: chainId,
          result,
        })
        .onConflict((oc) => oc.column("request_hash").doUpdateSet({ result }))
        .execute();
    }),
  getRpcRequestResult: async ({ request, chainId }) =>
    db.wrap({ method: "getRpcRequestResult" }, async () => {
      const row = await db
        .selectFrom(`rpc_request_${chainId}`)
        .select("result")
        .where("request_hash", "=", ksql`MD5(${request})`)
        .executeTakeFirst();

      return row?.result;
    }),
  pruneRpcRequestResult: async ({ blocks, chainId }) =>
    db.wrap({ method: "pruneRpcRequestResult" }, async () => {
      if (blocks.length === 0) return;

      const numbers = blocks.map(({ number }) =>
        hexToBigInt(number).toString(),
      );

      await db
        .deleteFrom(`rpc_request_${chainId}`)
        .where("block_number", "in", numbers)
        .execute();
    }),
  pruneByChain: async ({ fromBlock, chainId }) =>
    db.wrap({ method: "pruneByChain" }, () =>
      db.transaction().execute(async (tx) => {
        await tx
          .deleteFrom(`log_${chainId}`)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom(`block_${chainId}`)
          .where("number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom(`rpc_request_${chainId}`)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom(`trace_${chainId}`)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom(`transaction_${chainId}`)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom(`transaction_receipt_${chainId}`)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
      }),
    ),
  getEvents: async ({ filters, from, to, limit }) => {
    const joinInfo = {
      logs: filters.some((filter) => filter.type === "log"),
      traces: filters.some(
        (filter) => filter.type === "trace" || filter.type === "transfer",
      ),
      receipts: filters.some((filter) => shouldGetTransactionReceipt(filter)),
    };

    const filterCte = (db: QueryCreator<PonderSyncSchema>, i: number) => {
      const filter = filters[i]!;
      return filter.type === "log"
        ? logSQL(filter, db, i, joinInfo)
        : filter.type === "block"
          ? blockSQL(filter, db, i, joinInfo)
          : filter.type === "transaction"
            ? transactionSQL(filter, db, i, joinInfo)
            : filter.type === "transfer"
              ? transferSQL(filter, db, i, joinInfo)
              : traceSQL(filter, db, i, joinInfo);
    };

    let filterQuery = db.with("filter_0", (db) => filterCte(db, 0));
    for (let i = 1; i < filters.length; i++) {
      filterQuery = filterQuery.with(`filter_${i}`, (db) => filterCte(db, i));
    }

    const query = filterQuery
      .with("event", (db) => {
        let subquery = db.selectFrom("filter_0").selectAll();
        for (let i = 1; i < filters.length; i++) {
          subquery = subquery.unionAll(
            db.selectFrom(`filter_${i}` as "filter_0").selectAll(),
          );
        }
        return subquery;
      })
      .selectFrom("event")
      .select([
        "event.filter_index",
        "event.checkpoint",
        "event.chain_id",

        "event.block_number",
        "event.tx_index",
      ])
      .$if(joinInfo.logs, (qb) =>
        qb.select([
          "event.log_index",
          "event.log_address",
          "event.log_data",
          "event.log_topic0",
          "event.log_topic1",
          "event.log_topic2",
          "event.log_topic3",
        ]),
      )
      .$if(joinInfo.traces, (qb) =>
        qb.select([
          "event.trace_index",
          "event.trace_callType",
          "event.trace_from",
          "event.trace_to",
          "event.trace_value",
          "event.trace_functionSelector",
          "event.trace_isReverted",
          "event.trace_gas",
          "event.trace_gasUsed",
          "event.trace_input",
          "event.trace_output",
          "event.trace_error",
          "event.trace_revertReason",
          "event.trace_subcalls",
        ]),
      )
      // Join blocks
      .innerJoin("blocks", (join) =>
        join.onRef("event.block_number", "=", "blocks.number"),
      )
      .select([
        // "blocks.number as block_number", // Selected above
        "blocks.hash as block_hash",
        "blocks.parentHash as block_parentHash",
        "blocks.timestamp as block_timestamp",
        "blocks.baseFeePerGas as block_baseFeePerGas",
        "blocks.difficulty as block_difficulty",
        "blocks.extraData as block_extraData",
        "blocks.gasLimit as block_gasLimit",
        "blocks.gasUsed as block_gasUsed",
        "blocks.logsBloom as block_logsBloom",
        "blocks.miner as block_miner",
        "blocks.mixHash as block_mixHash",
        "blocks.nonce as block_nonce",
        "blocks.receiptsRoot as block_receiptsRoot",
        "blocks.sha3Uncles as block_sha3Uncles",
        "blocks.size as block_size",
        "blocks.stateRoot as block_stateRoot",
        "blocks.totalDifficulty as block_totalDifficulty",
        "blocks.transactionsRoot as block_transactionsRoot",
      ])
      // Join transactions
      .leftJoin("transactions", (join) =>
        join
          .onRef("event.block_number", "=", "transactions.blockNumber")
          .onRef("event.tx_index", "=", "transactions.transactionIndex"),
      )
      .select([
        // "transactions.transactionIndex as tx_index", // Selected above
        "transactions.hash as tx_hash",
        "transactions.from as tx_from",
        "transactions.to as tx_to",
        "transactions.type as tx_type",
        "transactions.input as tx_input",
        "transactions.value as tx_value",
        "transactions.nonce as tx_nonce",
        "transactions.gas as tx_gas",
        "transactions.gasPrice as tx_gasPrice",
        "transactions.maxFeePerGas as tx_maxFeePerGas",
        "transactions.maxPriorityFeePerGas as tx_maxPriorityFeePerGas",
        "transactions.r as tx_r",
        "transactions.s as tx_s",
        "transactions.v as tx_v",
        "transactions.accessList as tx_accessList",
      ])
      // Join transaction receipts
      .$if(joinInfo.receipts, (qb) =>
        qb
          .leftJoin("transactionReceipts", (join) =>
            join
              .onRef(
                "event.block_number",
                "=",
                "transactionReceipts.blockNumber",
              )
              .onRef(
                "event.tx_index",
                "=",
                "transactionReceipts.transactionIndex",
              ),
          )
          .select([
            "transactionReceipts.status as tx_receipt_status",
            "transactionReceipts.contractAddress as tx_receipt_contractAddress",
            "transactionReceipts.cumulativeGasUsed as tx_receipt_cumulativeGasUsed",
            "transactionReceipts.effectiveGasPrice as tx_receipt_effectiveGasPrice",
            "transactionReceipts.from as tx_receipt_from",
            "transactionReceipts.gasUsed as tx_receipt_gasUsed",
            "transactionReceipts.logsBloom as tx_receipt_logsBloom",
            "transactionReceipts.to as tx_receipt_to",
            "transactionReceipts.type as tx_receipt_type",
          ]),
      )
      .where("event.checkpoint", ">", from)
      .where("event.checkpoint", "<=", to)
      .orderBy("event.checkpoint", "asc")
      // .orderBy("event.filter_index", "asc")
      .limit(limit);

    const rows = await db.wrap(
      {
        method: "getEvents",
        shouldRetry(error) {
          return error.message.includes("statement timeout") === false;
        },
      },
      async () => {
        // const planText = await query.explain("text", ksql`analyze, buffers`);
        // const prettyPlanText = planText
        //   .map((line) => line["QUERY PLAN"])
        //   .join("\n");
        // console.log(prettyPlanText);

        // const planJson = await query.explain("json", ksql`analyze`);
        // const prettyPlanJson = JSON.stringify(planJson, null, 2);
        // console.log(prettyPlanJson);

        return await query.execute();
      },
    );

    type RowType = (typeof rows)[number];

    const events = rows.map((row_) => {
      const row = row_ as NonNull<RowType>;

      const filter = filters[row.filter_index]!;

      const hasLog = row.log_index !== null && row.log_index !== undefined;
      const hasTrace =
        row.trace_index !== null && row.trace_index !== undefined;
      const hasTransaction =
        row.tx_index !== null && row.tx_index !== undefined;
      const hasTransactionReceipt =
        shouldGetTransactionReceipt(filter) &&
        row.tx_receipt_status !== null &&
        row.tx_receipt_status !== undefined;

      return {
        chainId: row.chain_id,
        checkpoint: row.checkpoint,
        sourceIndex: row.filter_index,
        block: {
          number: BigInt(row.block_number),
          hash: row.block_hash,
          parentHash: row.block_parentHash,
          timestamp: BigInt(row.block_timestamp),
          baseFeePerGas:
            row.block_baseFeePerGas !== null
              ? BigInt(row.block_baseFeePerGas)
              : null,
          difficulty: BigInt(row.block_difficulty),
          extraData: row.block_extraData,
          gasLimit: BigInt(row.block_gasLimit),
          gasUsed: BigInt(row.block_gasUsed),
          logsBloom: row.block_logsBloom,
          miner: checksumAddress(row.block_miner),
          mixHash: row.block_mixHash,
          nonce: row.block_nonce,
          receiptsRoot: row.block_receiptsRoot,
          sha3Uncles: row.block_sha3Uncles,
          size: BigInt(row.block_size),
          stateRoot: row.block_stateRoot,
          totalDifficulty:
            row.block_totalDifficulty !== null
              ? BigInt(row.block_totalDifficulty)
              : null,
          transactionsRoot: row.block_transactionsRoot,
        },
        log: hasLog
          ? {
              id: `${row.block_hash}-${numberToHex(row.log_index!)}`,
              address: checksumAddress(row.log_address!),
              data: row.log_data,
              logIndex: Number(row.log_index!),
              removed: false,
              topics: [
                row.log_topic0,
                row.log_topic1,
                row.log_topic2,
                row.log_topic3,
              ].filter((t): t is Hex => t !== null) as [Hex, ...Hex[]] | [],
            }
          : undefined,
        trace: hasTrace
          ? {
              id: `${row.tx_hash}-${row.trace_index}`,
              traceIndex: Number(row.trace_index),
              type: row.trace_callType as Trace["type"],
              from: checksumAddress(row.trace_from),
              to: checksumAddress(row.trace_to),
              value: BigInt(row.trace_value),
              gas: BigInt(row.trace_gas),
              gasUsed: BigInt(row.trace_gasUsed),
              input: row.trace_input,
              output: row.trace_output,
              subcalls: Number(row.trace_subcalls),
            }
          : undefined,
        transaction: hasTransaction
          ? {
              hash: row.tx_hash,
              transactionIndex: Number(row.tx_index),
              from: checksumAddress(row.tx_from),
              to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
              gas: BigInt(row.tx_gas),
              input: row.tx_input,
              nonce: Number(row.tx_nonce),
              r: row.tx_r,
              s: row.tx_s,
              value: BigInt(row.tx_value),
              v: row.tx_v !== null ? BigInt(row.tx_v) : null,
              ...(row.tx_type === "0x0"
                ? {
                    type: "legacy",
                    gasPrice: BigInt(row.tx_gasPrice!),
                  }
                : row.tx_type === "0x1"
                  ? {
                      type: "eip2930",
                      gasPrice: BigInt(row.tx_gasPrice!),
                      accessList: JSON.parse(row.tx_accessList!),
                    }
                  : row.tx_type === "0x2"
                    ? {
                        type: "eip1559",
                        maxFeePerGas: BigInt(row.tx_maxFeePerGas!),
                        maxPriorityFeePerGas: BigInt(
                          row.tx_maxPriorityFeePerGas!,
                        ),
                      }
                    : row.tx_type === "0x7e"
                      ? {
                          type: "deposit",
                          maxFeePerGas:
                            row.tx_maxFeePerGas !== null
                              ? BigInt(row.tx_maxFeePerGas!)
                              : undefined,
                          maxPriorityFeePerGas:
                            row.tx_maxPriorityFeePerGas !== null
                              ? BigInt(row.tx_maxPriorityFeePerGas!)
                              : undefined,
                        }
                      : {
                          type: row.tx_type,
                        }),
            }
          : undefined,
        transactionReceipt: hasTransactionReceipt
          ? {
              status:
                row.tx_receipt_status === "0x1"
                  ? "success"
                  : row.tx_receipt_status === "0x0"
                    ? "reverted"
                    : (row.tx_receipt_status as TransactionReceipt["status"]),
              contractAddress: row.tx_receipt_contractAddress
                ? checksumAddress(row.tx_receipt_contractAddress)
                : null,
              cumulativeGasUsed: BigInt(row.tx_receipt_cumulativeGasUsed),
              effectiveGasPrice: BigInt(row.tx_receipt_effectiveGasPrice),
              from: checksumAddress(row.tx_receipt_from),
              gasUsed: BigInt(row.tx_receipt_gasUsed),
              logsBloom: row.tx_receipt_logsBloom,
              to: row.tx_receipt_to ? checksumAddress(row.tx_receipt_to) : null,
              type:
                row.tx_receipt_type === "0x0"
                  ? "legacy"
                  : row.tx_receipt_type === "0x1"
                    ? "eip2930"
                    : row.tx_receipt_type === "0x2"
                      ? "eip1559"
                      : row.tx_receipt_type === "0x7e"
                        ? "deposit"
                        : row.tx_receipt_type,
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
});

type FilterRow = {
  // IDs
  checkpoint: string | null;
  filter_index: number;
  chain_id: number;
  block_number: string;
  tx_index: number | null;

  // Log
  log_index: number;
  log_address: Hex;
  log_data: Hex;
  log_topic0: Hex;
  log_topic1: Hex;
  log_topic2: Hex;
  log_topic3: Hex;

  // Trace
  trace_index: number;
  trace_callType: Trace["type"];
  trace_from: Hex;
  trace_to: Hex;
  trace_value: Hex;
  trace_functionSelector: Hex;
  trace_isReverted: boolean;
  trace_gas: string;
  trace_gasUsed: string;
  trace_input: Hex;
  trace_output: Hex;
  trace_error: Hex;
  trace_revertReason: Hex;
  trace_subcalls: number;
};

type FilterQb = SelectQueryBuilder<
  PonderSyncSchema,
  any,
  Partial<unknown> & FilterRow
>;

const logSQL = (
  filter: LogFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
  joinInfo: { logs: boolean; traces: boolean },
) => {
  const table = `log_${filter.chainId}` as const;
  const result = db
    .selectFrom(table)
    // Filters
    .$call((qb) => {
      for (const idx of [0, 1, 2, 3] as const) {
        // If it's an array of length 1, collapse it.
        const raw = filter[`topic${idx}`] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
        if (Array.isArray(topic)) {
          qb = qb.where(`${table}.topic${idx}`, "in", topic);
        } else {
          qb = qb.where(`${table}.topic${idx}`, "=", topic);
        }
      }
      return qb;
    })
    .$call((qb) => addressSQL(db, qb, filter.address, `${table}.address`))
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where(`${table}.blockNumber`, ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where(`${table}.blockNumber`, "<=", filter.toBlock!.toString()),
    )
    // Joins and selects
    // Base
    .select([
      ksql.raw(index.toString()).$castTo<number>().as("filter_index"),
      `${table}.checkpoint as checkpoint`,
      `${table}.chainId as chain_id`,

      `${table}.blockNumber as block_number`,
      `${table}.transactionIndex as tx_index`,
    ])
    // Logs
    .$call((qb) =>
      qb.select([
        `${table}.logIndex as log_index`,
        `${table}.address as log_address`,
        `${table}.data as log_data`,
        `${table}.topic0 as log_topic0`,
        `${table}.topic1 as log_topic1`,
        `${table}.topic2 as log_topic2`,
        `${table}.topic3 as log_topic3`,
      ]),
    )
    // Traces
    .$if(joinInfo.traces, (qb) => selectTraceColumnsAsNull(qb))
    .orderBy("checkpoint", "asc");

  return result as FilterQb;
};

const blockSQL = (
  filter: BlockFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
  joinInfo: { logs: boolean; traces: boolean },
) => {
  const result = db
    .selectFrom("blocks")
    // Filters
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
    )
    // Joins and selects
    // Base
    .select([
      ksql.raw(index.toString()).$castTo<number>().as("filter_index"),
      "blocks.checkpoint as checkpoint",
      "blocks.chainId as chain_id",

      "blocks.number as block_number",
      ksql`null::integer`.as("tx_index"),
    ])
    // Logs
    .$if(joinInfo.logs, (qb) => selectLogColumnsAsNull(qb))
    // Traces
    .$if(joinInfo.traces, (qb) => selectTraceColumnsAsNull(qb));

  return result as FilterQb;
};

const transactionSQL = (
  filter: TransactionFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
  joinInfo: { logs: boolean; traces: boolean },
) =>
  db
    .selectFrom("transactions")
    // Filters
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "transactions.from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "transactions.to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb
        .leftJoin("transactionReceipts", (join) =>
          join
            .onRef(
              "transactions.blockNumber",
              "=",
              "transactionReceipts.blockNumber",
            )
            .onRef(
              "transactions.transactionIndex",
              "=",
              "transactionReceipts.transactionIndex",
            ),
        )
        .where("transactionReceipts.status", "=", "0x1"),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("transactions.blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("transactions.blockNumber", "<=", filter.toBlock!.toString()),
    )
    // Joins and selects
    // Base
    .select([
      ksql.raw(index.toString()).$castTo<number>().as("filter_index"),
      "transactions.checkpoint as checkpoint",
      "transactions.chainId as chain_id",

      "transactions.blockNumber as block_number",
      "transactions.transactionIndex as tx_index",
    ])
    // Logs
    .$if(joinInfo.logs, (qb) => selectLogColumnsAsNull(qb))
    // Traces
    .$if(joinInfo.traces, (qb) => selectTraceColumnsAsNull(qb)) as FilterQb;

const transferSQL = (
  filter: TransferFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
  joinInfo: { logs: boolean; traces: boolean },
) =>
  db
    .selectFrom("traces")
    // Filters
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "traces.from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "traces.to"))
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
    // Joins and selects
    // Base
    .select([
      ksql.raw(index.toString()).$castTo<number>().as("filter_index"),
      "traces.checkpoint as checkpoint",
      "traces.chainId as chain_id",

      "traces.blockNumber as block_number",
      "traces.transactionIndex as tx_index",
    ])
    // Logs
    .$if(joinInfo.logs, (qb) => selectLogColumnsAsNull(qb))
    // Traces
    .$call((qb) =>
      qb.select([
        "traces.index as trace_index",
        "traces.type as trace_callType",
        "traces.from as trace_from",
        "traces.to as trace_to",
        "traces.value as trace_value",
        "traces.functionSelector as trace_functionSelector",
        "traces.isReverted as trace_isReverted",

        "traces.gas as trace_gas",
        "traces.gasUsed as trace_gasUsed",
        "traces.input as trace_input",
        "traces.output as trace_output",
        "traces.error as trace_error",
        "traces.revertReason as trace_revertReason",
        "traces.subcalls as trace_subcalls",
      ]),
    ) as unknown as FilterQb;

const traceSQL = (
  filter: TraceFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
  joinInfo: { logs: boolean; traces: boolean },
) =>
  db
    .selectFrom("traces")
    // Filters
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "traces.from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "traces.to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("traces.isReverted", "=", 0),
    )
    .$if(filter.callType !== undefined, (qb) =>
      qb.where("traces.type", "=", filter.callType!),
    )
    .$if(filter.functionSelector !== undefined, (qb) => {
      if (Array.isArray(filter.functionSelector)) {
        return qb.where(
          "traces.functionSelector",
          "in",
          filter.functionSelector!,
        );
      } else {
        return qb.where(
          "traces.functionSelector",
          "=",
          filter.functionSelector!,
        );
      }
    })
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("traces.blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("traces.blockNumber", "<=", filter.toBlock!.toString()),
    )
    // Joins and selects
    // Base
    .select([
      ksql.raw(index.toString()).$castTo<number>().as("filter_index"),
      "traces.checkpoint as checkpoint",
      "traces.chainId as chain_id",

      "traces.blockNumber as block_number",
      "traces.transactionIndex as tx_index",
    ])
    // Logs
    .$if(joinInfo.logs, (qb) => selectLogColumnsAsNull(qb))
    // Traces
    .$call((qb) =>
      qb.select([
        "traces.index as trace_index",
        "traces.type as trace_callType",
        "traces.from as trace_from",
        "traces.to as trace_to",
        "traces.value as trace_value",
        "traces.functionSelector as trace_functionSelector",
        "traces.isReverted as trace_isReverted",

        "traces.gas as trace_gas",
        "traces.gasUsed as trace_gasUsed",
        "traces.input as trace_input",
        "traces.output as trace_output",
        "traces.error as trace_error",
        "traces.revertReason as trace_revertReason",
        "traces.subcalls as trace_subcalls",
      ]),
    ) as unknown as FilterQb;

const selectLogColumnsAsNull = (
  qb: SelectQueryBuilder<PonderSyncSchema, any, any>,
) =>
  qb.select([
    ksql`null::integer`.as("log_index"),
    ksql`null::varchar(42)`.as("log_address"),
    ksql`null::text`.as("log_data"),
    ksql`null::varchar(66)`.as("log_topic0"),
    ksql`null::varchar(66)`.as("log_topic1"),
    ksql`null::varchar(66)`.as("log_topic2"),
    ksql`null::varchar(66)`.as("log_topic3"),
  ]);

const selectTraceColumnsAsNull = (
  qb: SelectQueryBuilder<PonderSyncSchema, any, any>,
) =>
  qb.select([
    ksql`null::integer`.as("trace_index"),
    ksql`null::text`.as("trace_callType"),
    ksql`null::varchar(42)`.as("trace_from"),
    ksql`null::varchar(42)`.as("trace_to"),
    ksql`null::numeric(78,0)`.as("trace_value"),
    ksql`null::text`.as("trace_functionSelector"),
    ksql`null::integer`.as("trace_isReverted"),

    ksql`null::numeric(78,0)`.as("trace_gas"),
    ksql`null::numeric(78,0)`.as("trace_gasUsed"),
    ksql`null::text`.as("trace_input"),
    ksql`null::text`.as("trace_output"),
    ksql`null::text`.as("trace_error"),
    ksql`null::text`.as("trace_revertReason"),
    ksql`null::integer`.as("trace_subcalls"),
  ]);

const addressSQL = (
  db: QueryCreator<PonderSyncSchema>,
  qb: SelectQueryBuilder<PonderSyncSchema, any, {}>,
  address: LogFilter["address"],
  column:
    | "address"
    | "from"
    | "to"
    | `${string}.address`
    | `${string}.from`
    | `${string}.to`,
) => {
  if (typeof address === "string") return qb.where(column, "=", address);
  if (isAddressFactory(address)) {
    const factoryId = `${address.address}_${address.eventSelector}_${address.childAddressLocation}`;
    return qb.where(
      column,
      "in",
      db
        .selectFrom("factory_address")
        .select(["address"])
        .distinct()
        .where(
          "factory_address.factory_integer_id",
          "=",
          ksql`(SELECT integer_id FROM ponder_sync.factory WHERE factory_id = ${factoryId})`,
        ),
    );
  }
  if (Array.isArray(address)) return qb.where(column, "in", address);

  return qb;
};
