import type { Common } from "@/common/common.js";
import { ImmediateRetryError } from "@/common/errors.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { RawEvent } from "@/sync/events.js";
import { type FragmentId, getFragmentIds } from "@/sync/fragments.js";
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
import {
  EVENT_TYPES,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { type Interval, intervalIntersectionMany } from "@/utils/interval.js";
import { type Kysely, type SelectQueryBuilder, sql as ksql } from "kysely";
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
import { createMissingPartitions } from "./partition.js";

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
    // shouldUpdateCheckpoint: boolean;
    chainId: number;
  }): Promise<void>;
  insertBlocks(args: {
    blocks: SyncBlock[];
    chainId: number;
  }): Promise<void>;
  /** Return true if the block receipt is present in the database. */
  hasBlock(args: { hash: Hash }): Promise<boolean>;
  insertTransactions(args: {
    transactions: SyncTransaction[];
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
  getChildAddresses: ({ filter, limit }) =>
    db.wrap({ method: "getChildAddresses" }, async () => {
      return await db
        .selectFrom("logs")
        .$call((qb) => logFactorySQL(qb, filter))
        .orderBy("block_number asc")
        .orderBy("log_index asc")
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
  insertLogs: async ({ logs, chainId }) => {
    // Calculate `batchSize` based on how many parameters the input will have.
    // Return early if there are no logs.
    const firstLog = logs[0];
    if (firstLog === undefined) return;
    const firstLogEncoded = encodeLog({ log: firstLog, chainId });
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(firstLogEncoded).length,
    );

    while (logs.length > 0) {
      const batch = logs
        .splice(0, batchSize)
        .map((log) => encodeLog({ log, chainId }));

      await db.wrap({ method: "insertLogs" }, async () => {
        try {
          await db
            .insertInto("logs")
            .values(batch)
            .onConflict((oc) =>
              oc.columns(["block_number", "log_index"]).doNothing(),
            )
            .execute();
        } catch (e) {
          if ((e as Error).message?.toLowerCase().includes("partition")) {
            await createMissingPartitions({
              tableName: "logs",
              chainId,
              blockNumbers: batch.map(({ block_number }) => block_number),
              db,
              common,
            });
            throw new ImmediateRetryError();
          }
          throw e;
        }
      });
    }
  },
  insertBlocks: async ({ blocks, chainId }) => {
    const firstBlock = blocks[0];
    if (firstBlock === undefined) return;
    const firstBlockEncoded = encodeBlock({ block: firstBlock, chainId });
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(firstBlockEncoded).length,
    );

    while (blocks.length > 0) {
      const batch = blocks
        .splice(0, batchSize)
        .map((block) => encodeBlock({ block, chainId }));

      await db.wrap({ method: "insertBlocks" }, async () => {
        try {
          await db
            .insertInto("blocks")
            .values(batch)
            .onConflict((oc) => oc.column("number").doNothing())
            .execute();
        } catch (e) {
          if ((e as Error).message?.toLowerCase().includes("partition")) {
            await createMissingPartitions({
              tableName: "blocks",
              chainId,
              blockNumbers: batch.map(({ number }) => number),
              db,
              common,
            });
            throw new ImmediateRetryError();
          }
          throw e;
        }
      });
    }
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
    const firstTx = transactions[0];
    if (firstTx === undefined) return;
    const firstTxEncoded = encodeTransaction({ transaction: firstTx, chainId });
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(firstTxEncoded).length,
    );

    while (transactions.length > 0) {
      const batch = transactions
        .splice(0, batchSize)
        .map((transaction) => encodeTransaction({ transaction, chainId }));

      await db.wrap({ method: "insertTransactions" }, async () => {
        try {
          await db
            .insertInto("transactions")
            .values(batch)
            .onConflict((oc) =>
              oc.columns(["block_number", "transaction_index"]).doNothing(),
            )
            .execute();
        } catch (e) {
          if ((e as Error).message?.toLowerCase().includes("partition")) {
            await createMissingPartitions({
              tableName: "transactions",
              chainId,
              blockNumbers: batch.map(({ block_number }) => block_number),
              db,
              common,
            });
            throw new ImmediateRetryError();
          }
          throw e;
        }
      });
    }
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
    const firstTxReceipt = transactionReceipts[0];
    if (firstTxReceipt === undefined) return;
    const firstTxEncoded = encodeTransactionReceipt({
      transactionReceipt: firstTxReceipt,
      chainId,
    });
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(firstTxEncoded).length,
    );

    while (transactionReceipts.length > 0) {
      const batch = transactionReceipts
        .splice(0, batchSize)
        .map((transactionReceipt) =>
          encodeTransactionReceipt({ transactionReceipt, chainId }),
        );

      await db.wrap({ method: "insertTransactionReceipts" }, async () => {
        try {
          await db
            .insertInto("transaction_receipts")
            .values(batch)
            .onConflict((oc) =>
              oc.columns(["block_number", "transaction_index"]).doNothing(),
            )
            .execute();
        } catch (e) {
          if ((e as Error).message?.toLowerCase().includes("partition")) {
            await createMissingPartitions({
              tableName: "transaction_receipts",
              chainId,
              blockNumbers: batch.map(({ block_number }) => block_number),
              db,
              common,
            });
            throw new ImmediateRetryError();
          }
          throw e;
        }
      });
    }
  },
  hasTransactionReceipt: async ({ hash }) =>
    db.wrap({ method: "hasTransactionReceipt" }, async () => {
      return await db
        .selectFrom("transaction_receipts")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTraces: async ({ traces, chainId }) => {
    const firstTrace = traces[0];
    if (firstTrace === undefined) return;
    const batchSize = Math.floor(
      common.options.databaseMaxQueryParameters /
        Object.keys(
          encodeTrace({
            trace: firstTrace.trace.trace,
            block: firstTrace.block,
            transaction: firstTrace.transaction,
            chainId,
          }),
        ).length,
    );

    while (traces.length > 0) {
      const batch = traces
        .splice(0, batchSize)
        .map(({ trace, block, transaction }) =>
          encodeTrace({ trace: trace.trace, block, transaction, chainId }),
        );

      await db.wrap({ method: "insertTraces" }, async () => {
        try {
          await db
            .insertInto("traces")
            .values(batch)
            .onConflict((oc) =>
              oc
                .columns(["block_number", "transaction_index", "trace_index"])
                .doNothing(),
            )
            .execute();
        } catch (e) {
          if ((e as Error).message?.toLowerCase().includes("partition")) {
            await createMissingPartitions({
              tableName: "traces",
              chainId,
              blockNumbers: batch.map(({ block_number }) => block_number),
              db,
              common,
            });
            throw new ImmediateRetryError();
          }
          throw e;
        }
      });
    }
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

        .where("request_hash", "=", ksql`MD5(${request})`)
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
          .where("chain_id", "=", chainId)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("blocks")
          .where("chain_id", "=", chainId)
          .where("number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("traces")
          .where("chain_id", "=", chainId)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("transactions")
          .where("chain_id", "=", chainId)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("transaction_receipts")
          .where("chain_id", "=", chainId)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .where("block_number", ">=", fromBlock.toString())
          .execute();
      }),
    ),
  getEvents: async ({ filters, from, to, limit }) => {
    // // TODO: accept chainId as argument
    // const chainId = filters[0]?.chainId!;
    // TODO: use block numbers instead of checkpoints for pagination, or use streaming
    const fromBlock = Number(decodeCheckpoint(from).blockNumber);
    const toBlock = Number(decodeCheckpoint(to).blockNumber);
    // // TODO: remove
    // const adjustedLimit = limit + 2;

    const rows = await db.wrap(
      {
        method: "getEvents",
        shouldRetry(error) {
          return error.message.includes("statement timeout") === false;
        },
      },
      async () => {
        let filterQuery:
          | SelectQueryBuilder<
              PonderSyncSchema,
              "logs" | "blocks" | "traces" | "transactions",
              {
                filter_index: number;
                block_number: number;
                transaction_index: number;
                event_type: number;
                event_index: number;

                log_index: number | null;
                trace_index: number | null;
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
          filterQuery =
            // @ts-ignore
            filterQuery === undefined ? _query : filterQuery.unionAll(_query);
        }

        const query = db
          .with("event", () => filterQuery!)
          .selectFrom("event")
          .select([
            "event.filter_index as event_filter_index",
            "event.block_number as event_block_number",
            "event.transaction_index as event_transaction_index",
            "event.event_type as event_type",
            "event.event_index as event_index",
            "event.log_index as event_log_index",
            "event.trace_index as event_trace_index",
          ])
          .innerJoin("blocks", "blocks.number", "event.block_number")
          .select([
            "blocks.hash as block_hash",
            "blocks.parent_hash as block_parentHash",
            "blocks.timestamp as block_timestamp",
            "blocks.body as block_body",
          ])
          .leftJoin("logs", (join) =>
            join
              .onRef("logs.block_number", "=", "event.block_number")
              .onRef("logs.log_index", "=", "event.log_index"),
          )
          .select([
            "logs.address as log_address",
            "logs.data as log_data",
            "logs.topic0 as log_topic0",
            "logs.topic1 as log_topic1",
            "logs.topic2 as log_topic2",
            "logs.topic3 as log_topic3",
          ])
          .leftJoin("transactions", (join) =>
            join
              .onRef("transactions.block_number", "=", "event.block_number")
              .onRef(
                "transactions.transaction_index",
                "=",
                "event.transaction_index",
              ),
          )
          .select([
            "transactions.body as tx_body",
            "transactions.from as tx_from",
            "transactions.hash as tx_hash",
            "transactions.to as tx_to",
            "transactions.body as tx_body",
          ])
          .leftJoin("transaction_receipts", (join) =>
            join
              .onRef(
                "transaction_receipts.block_number",
                "=",
                "event.block_number",
              )
              .onRef(
                "transaction_receipts.transaction_index",
                "=",
                "event.transaction_index",
              ),
          )
          .select([
            "transaction_receipts.status as tx_receipt_status",
            "transaction_receipts.body as tx_receipt_body",
          ])
          .leftJoin("traces", (join) =>
            join
              .onRef("traces.block_number", "=", "event.block_number")
              .onRef("traces.transaction_index", "=", "event.transaction_index")
              .onRef("traces.trace_index", "=", "event.trace_index"),
          )
          .select([
            "traces.type as trace_callType",
            "traces.from as trace_from",
            "traces.to as trace_to",
            "traces.value as trace_value",
            "traces.function_selector as trace_functionSelector",
            "traces.is_reverted as trace_isReverted",
            "traces.body as trace_body",
          ])
          .where("event.block_number", ">=", fromBlock)
          .where("event.block_number", "<=", toBlock)
          .orderBy("event.block_number", "asc")
          .orderBy("event.transaction_index", "asc")
          .orderBy("event.event_type", "asc")
          .orderBy("event.event_index", "asc")
          .orderBy("event.filter_index", "asc");
        // .limit(adjustedLimit);

        return await query.execute();
      },
    );

    const events = rows.map((_row) => {
      // Without this cast, the block_ and tx_ fields are all nullable
      // which makes this very annoying. Should probably add a runtime check
      // that those fields are indeed present before continuing here.
      const row = _row as NonNull<(typeof rows)[number]>;

      const filter = filters[row.event_filter_index]!;

      const checkpoint = encodeCheckpoint({
        chainId: BigInt(filter.chainId),
        blockTimestamp: Number(row.block_timestamp),
        blockNumber: BigInt(row.event_block_number),
        transactionIndex: BigInt(row.event_transaction_index),
        eventType: row.event_type,
        eventIndex: BigInt(row.event_index),
      });

      const hasLog = row.log_data !== null;
      const hasTransaction = row.tx_body !== null;
      const hasTrace = row.trace_body !== null;
      // const hasTransactionReceipt = row.tx_receipt_body !== null;
      const hasTransactionReceipt = shouldGetTransactionReceipt(filter);

      return {
        chainId: filter.chainId,
        checkpoint,
        sourceIndex: Number(row.event_filter_index),
        block: {
          baseFeePerGas:
            row.block_body.baseFeePerGas !== null
              ? BigInt(row.block_body.baseFeePerGas)
              : null,
          difficulty: BigInt(row.block_body.difficulty),
          extraData: row.block_body.extraData,
          gasLimit: BigInt(row.block_body.gasLimit),
          gasUsed: BigInt(row.block_body.gasUsed),
          hash: row.block_hash,
          logsBloom: row.block_body.logsBloom,
          miner: checksumAddress(row.block_body.miner),
          mixHash: row.block_body.mixHash,
          nonce: row.block_body.nonce,
          number: BigInt(row.event_block_number),
          parentHash: row.block_parentHash,
          receiptsRoot: row.block_body.receiptsRoot,
          sha3Uncles: row.block_body.sha3Uncles,
          size: BigInt(row.block_body.size),
          stateRoot: row.block_body.stateRoot,
          timestamp: BigInt(row.block_timestamp),
          totalDifficulty:
            row.block_body.totalDifficulty !== null
              ? BigInt(row.block_body.totalDifficulty)
              : null,
          transactionsRoot: row.block_body.transactionsRoot,
        },
        log: hasLog
          ? {
              // id: `${chainId}-${row.event_block_number}-${row.event_log_index}`,
              id: `${row.block_hash}-${numberToHex(row.event_log_index)}`,
              address: checksumAddress(row.log_address!),
              data: row.log_data,
              logIndex: Number(row.event_log_index),
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
              gas: BigInt(row.tx_body.gas),
              hash: row.tx_hash,
              input: row.tx_body.input,
              nonce: Number(row.tx_body.nonce),
              r: row.tx_body.r,
              s: row.tx_body.s,
              to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
              transactionIndex: Number(row.event_transaction_index),
              value: BigInt(row.tx_body.value),
              v: row.tx_body.v !== null ? BigInt(row.tx_body.v) : null,
              ...(row.tx_body.type === "0x0"
                ? {
                    type: "legacy",
                    gasPrice: BigInt(row.tx_body.gasPrice!),
                  }
                : row.tx_body.type === "0x1"
                  ? {
                      type: "eip2930",
                      gasPrice: BigInt(row.tx_body.gasPrice!),
                      accessList: JSON.parse(row.tx_body.accessList!),
                    }
                  : row.tx_body.type === "0x2"
                    ? {
                        type: "eip1559",
                        maxFeePerGas: BigInt(row.tx_body.maxFeePerGas!),
                        maxPriorityFeePerGas: BigInt(
                          row.tx_body.maxPriorityFeePerGas!,
                        ),
                      }
                    : row.tx_body.type === "0x7e"
                      ? {
                          type: "deposit",
                          maxFeePerGas:
                            row.tx_body.maxFeePerGas !== null
                              ? BigInt(row.tx_body.maxFeePerGas!)
                              : undefined,
                          maxPriorityFeePerGas:
                            row.tx_body.maxPriorityFeePerGas !== null
                              ? BigInt(row.tx_body.maxPriorityFeePerGas!)
                              : undefined,
                        }
                      : {
                          type: row.tx_body.type,
                        }),
            }
          : undefined,
        trace: hasTrace
          ? {
              // id: `${chainId}-${row.event_block_number}-${row.event_transaction_index}-${row.event_trace_index}`,
              id: `${row.tx_hash}-${row.event_trace_index}`,
              type: row.trace_callType as Trace["type"],
              from: checksumAddress(row.trace_from),
              to: checksumAddress(row.trace_to),
              gas: BigInt(row.trace_body.gas),
              gasUsed: BigInt(row.trace_body.gasUsed),
              input: row.trace_body.input,
              output: row.trace_body.output,
              value: BigInt(row.trace_value),
              traceIndex: Number(row.event_trace_index),
              subcalls: Number(row.trace_body.subcalls),
            }
          : undefined,
        transactionReceipt: hasTransactionReceipt
          ? {
              contractAddress: row.tx_receipt_body.contractAddress
                ? checksumAddress(row.tx_receipt_body.contractAddress)
                : null,
              cumulativeGasUsed: BigInt(row.tx_receipt_body.cumulativeGasUsed),
              effectiveGasPrice: BigInt(row.tx_receipt_body.effectiveGasPrice),
              from: checksumAddress(row.tx_receipt_body.from),
              gasUsed: BigInt(row.tx_receipt_body.gasUsed),
              logsBloom: row.tx_receipt_body.logsBloom,
              status:
                row.tx_receipt_status === "0x1"
                  ? "success"
                  : row.tx_receipt_status === "0x0"
                    ? "reverted"
                    : (row.tx_receipt_status as TransactionReceipt["status"]),
              to: row.tx_receipt_body.to
                ? checksumAddress(row.tx_receipt_body.to)
                : null,
              type:
                row.tx_receipt_body.type === "0x0"
                  ? "legacy"
                  : row.tx_receipt_body.type === "0x1"
                    ? "eip2930"
                    : row.tx_receipt_body.type === "0x2"
                      ? "eip1559"
                      : row.tx_receipt_body.type === "0x7e"
                        ? "deposit"
                        : row.tx_receipt_body.type,
            }
          : undefined,
      } satisfies RawEvent;
    });

    // TODO: Remove once limits are passed using block numbers instead of checkpoints
    const filteredEvents = events
      .filter((event) => event.checkpoint > from && event.checkpoint <= to)
      .slice(0, limit);

    let cursor: string;
    if (filteredEvents.length !== limit) {
      cursor = to;
    } else {
      cursor = filteredEvents[filteredEvents.length - 1]!.checkpoint;
    }

    return { events: filteredEvents, cursor };
  },
});

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
    .where("chain_id", "=", factory.chainId);

const addressSQL = (
  db: Kysely<PonderSyncSchema>,
  qb: SelectQueryBuilder<PonderSyncSchema, any, {}>,
  address: LogFilter["address"],
  column: "address" | "from" | "to",
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

const logSQL = (
  filter: LogFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("logs")
    .select([
      ksql.raw(`'${index}'`).as("filter_index"),
      "block_number",
      "transaction_index",
      ksql`5::integer`.as("event_type"),
      "log_index as event_index",

      "log_index",
      ksql`null::integer`.as("trace_index"),
    ])
    .$call((qb) => {
      for (const idx of [0, 1, 2, 3] as const) {
        // If it's an array of length 1, collapse it.
        const raw = filter[`topic${idx}`] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
        if (Array.isArray(topic)) {
          qb = qb.where((eb) =>
            eb.or(topic.map((t) => eb(`topic${idx}`, "=", t))),
          );
        } else {
          qb = qb.where(`topic${idx}`, "=", topic);
        }
      }
      return qb;
    })
    .$call((qb) => addressSQL(db, qb, filter.address, "address"))
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("block_number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("block_number", "<=", filter.toBlock!.toString()),
    );

const blockSQL = (
  filter: BlockFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("blocks")
    .select([
      ksql.raw(`'${index}'`).as("filter_index"),
      "number as block_number",
      ksql`9999999999999999::bigint`.as("transaction_index"),
      ksql`${ksql.raw(EVENT_TYPES.blocks.toString())}::integer`.as(
        "event_type",
      ),
      ksql`0::integer`.as("event_index"),

      ksql`null::integer`.as("log_index"),
      ksql`null::integer`.as("trace_index"),
    ])
    .$if(filter !== undefined && filter.interval !== undefined, (qb) =>
      qb.where(ksql`(number - ${filter.offset}) % ${filter.interval} = 0`),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("number", "<=", filter.toBlock!.toString()),
    );

const transactionSQL = (
  filter: TransactionFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("transactions")
    .select([
      ksql.raw(`'${index}'`).as("filter_index"),
      "transactions.block_number",
      "transactions.transaction_index",
      ksql`${ksql.raw(EVENT_TYPES.transactions.toString())}::integer`.as(
        "event_type",
      ),
      ksql`0::integer`.as("event_index"),

      ksql`null::integer`.as("log_index"),
      ksql`null::integer`.as("trace_index"),
    ])
    // .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.innerJoin("transaction_receipts", (join) =>
        join
          .onRef(
            "transactions.block_number",
            "=",
            "transaction_receipts.block_number",
          )
          .onRef(
            "transactions.transaction_index",
            "=",
            "transaction_receipts.transaction_index",
          )
          .on("transaction_receipts.status", "=", "0x1"),
      ),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("transactions.block_number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("transactions.block_number", "<=", filter.toBlock!.toString()),
    );

const transferSQL = (
  filter: TransferFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("traces")
    .select([
      ksql.raw(`'${index}'`).as("filter_index"),
      "block_number",
      "transaction_index",
      ksql`${ksql.raw(EVENT_TYPES.traces.toString())}::integer`.as(
        "event_type",
      ),
      "trace_index as event_index",

      ksql`null::integer`.as("log_index"),
      "trace_index",
    ])
    // .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "to"))
    .where("value", ">", "0")
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("is_reverted", "=", 0),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("block_number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("block_number", "<=", filter.toBlock!.toString()),
    );

const traceSQL = (
  filter: TraceFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("traces")
    .select([
      ksql.raw(`'${index}'`).as("filter_index"),
      "block_number",
      "transaction_index",
      ksql`${ksql.raw(EVENT_TYPES.traces.toString())}::integer`.as(
        "event_type",
      ),
      "trace_index as event_index",

      ksql`null::integer`.as("log_index"),
      "trace_index",
    ])
    // .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("is_reverted", "=", 0),
    )
    .$if(filter.callType !== undefined, (qb) =>
      qb.where("type", "=", filter.callType!),
    )
    .$if(filter.functionSelector !== undefined, (qb) => {
      if (Array.isArray(filter.functionSelector)) {
        return qb.where("function_selector", "in", filter.functionSelector!);
      } else {
        return qb.where("function_selector", "=", filter.functionSelector!);
      }
    })
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("block_number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("block_number", "<=", filter.toBlock!.toString()),
    );
