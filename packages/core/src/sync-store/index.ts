import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";

import type {
  BlockFilter,
  Factory,
  Filter,
  FilterWithoutBlocks,
  Fragment,
  FragmentId,
  LogFactory,
  LogFilter,
  RawEvent,
  Source,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import { buildEvents } from "@/sync/events.js";
import { isAddressFactory } from "@/sync/filter.js";
import { fragmentToId, getFragments } from "@/sync/fragments.js";
import type {
  LightBlock,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import { decodeCheckpoint, min } from "@/utils/checkpoint.js";
import type { Interval } from "@/utils/interval.js";
import { type Kysely, type SelectQueryBuilder, sql as ksql } from "kysely";
import type { InsertObject } from "kysely";
import { type Address, type Hash, type Hex, hexToBigInt, toHex } from "viem";
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
    sources: Source[];
    from: string;
    to: string;
    chainId: number;
    limit?: number;
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
    .where("chainId", "=", factory.chainId);

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
  insertLogs: async ({ logs, shouldUpdateCheckpoint, chainId }) => {
    if (logs.length === 0) return;
    await database.wrap(
      { method: "insertLogs", includeTraceLogs: true },
      async () => {
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
          await database.qb.sync
            .insertInto("logs")
            .values(
              logs
                .slice(i, i + batchSize)
                .map(({ log, block }) => encodeLog({ log, block, chainId })),
            )
            .onConflict((oc) =>
              oc.columns(["blockNumber", "logIndex"]).$call((qb) =>
                shouldUpdateCheckpoint
                  ? qb.doUpdateSet((eb) => ({
                      checkpoint: eb.ref("excluded.checkpoint"),
                    }))
                  : qb.doNothing(),
              ),
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
            .onConflict((oc) => oc.column("number").doNothing())
            .execute();
        }
      },
    );
  },
  hasBlock: async ({ hash }) =>
    database.wrap({ method: "hasBlock", includeTraceLogs: true }, async () => {
      return await database.qb.sync
        .selectFrom("blocks")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
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
          await database.qb.sync
            .insertInto("transactions")
            .values(
              transactions
                .slice(i, i + batchSize)
                .map(({ transaction, block }) =>
                  encodeTransaction({ transaction, block, chainId }),
                ),
            )
            .onConflict((oc) =>
              oc
                .columns(["blockNumber", "transactionIndex"])
                .doUpdateSet((eb) => ({
                  checkpoint: eb.ref("excluded.checkpoint"),
                })),
            )
            .execute();
        }
      },
    );
  },
  hasTransaction: async ({ hash }) =>
    database.wrap(
      { method: "hasTransaction", includeTraceLogs: true },
      async () => {
        return await database.qb.sync
          .selectFrom("transactions")
          .select("hash")
          .where("hash", "=", hash)
          .executeTakeFirst()
          .then((result) => result !== undefined);
      },
    ),
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
      },
    );
  },
  hasTransactionReceipt: async ({ hash }) =>
    database.wrap(
      { method: "hasTransactionReceipt", includeTraceLogs: true },
      async () => {
        return await database.qb.sync
          .selectFrom("transactionReceipts")
          .select("transactionHash")
          .where("transactionHash", "=", hash)
          .executeTakeFirst()
          .then((result) => result !== undefined);
      },
    ),
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
                trace: traces[0]!.trace.trace,
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
      },
    );
  },
  getEvents: async ({ sources, from, to, chainId, limit }) =>
    database.wrap({ method: "getEvents", includeTraceLogs: true }, async () => {
      const fromBlock = decodeCheckpoint(from).blockNumber.toString();
      const toBlock = decodeCheckpoint(to).blockNumber.toString();

      // TODO(kyle) use relative density heuristics to set
      // different limits for each query

      // TODO(kyle) use filters to determine which queries to run

      // TODO(kyle) how to know block number when using omnichain ordering?
      // make sure `from` and `to` are chain-specific

      const logsQ = database.qb.sync
        .selectFrom("logs")
        .selectAll()
        .where("blockNumber", ">", fromBlock)
        // .where("logIndex", ">", 0)
        .where("blockNumber", "<=", toBlock)
        // .where("logIndex", "<=", 2147483647)
        .orderBy("blockNumber", "asc")
        .orderBy("logIndex", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const blocksQ = database.qb.sync
        .selectFrom("blocks")
        .selectAll()
        .where("number", ">", fromBlock)
        .where("number", "<=", toBlock)
        .orderBy("number", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      const transactionsQ = database.qb.sync
        .selectFrom("transactions")
        .selectAll()
        .where("blockNumber", ">", fromBlock)
        // .where("transactionIndex", ">", 0)
        .where("blockNumber", "<=", toBlock)
        // .where("transactionIndex", "<=", 2147483647)
        .orderBy("blockNumber", "asc")
        .orderBy("transactionIndex", "asc")
        .$if(limit !== undefined, (qb) => qb.limit(limit!));

      // const transactionReceiptsQ = database.qb.sync
      //   .selectFrom("transactionReceipts")
      //   .selectAll()
      //   .where("blockNumber", ">", fromBlock)
      //   // .where("transactionIndex", ">", 0)
      //   .where("blockNumber", "<=", toBlock)
      //   // .where("transactionIndex", "<=", 2147483647)
      //   .orderBy("blockNumber", "asc")
      //   .orderBy("transactionIndex", "asc")
      //   .$if(limit !== undefined, (qb) => qb.limit(limit!));

      // const tracesQ = database.qb.sync
      //   .selectFrom("traces")
      //   .selectAll()
      //   .where("blockNumber", ">", fromBlock)
      //   // .where("index", ">", 0)
      //   .where("blockNumber", "<=", toBlock)
      //   // .where("index", "<=", 2147483647)
      //   .orderBy("blockNumber", "asc")
      //   .orderBy("index", "asc")
      //   .$if(limit !== undefined, (qb) => qb.limit(limit!));

      // const planText = await logsq.explain("text", ksql`analyze`);
      // const prettyPlanText = planText
      //   .map((line) => line["QUERY PLAN"])
      //   .join("\n");
      // console.log(prettyPlanText);

      const [logsRows, blocksRows, transactionsRows] = await Promise.all([
        logsQ.execute(),
        blocksQ.execute(),
        transactionsQ.execute(),
      ]);

      const supremum = min(
        logsRows.length === 0
          ? undefined
          : logsRows[logsRows.length - 1]!.checkpoint!,
        blocksRows.length === 0
          ? undefined
          : blocksRows[blocksRows.length - 1]!.checkpoint!,
        transactionsRows.length === 0
          ? undefined
          : transactionsRows[transactionsRows.length - 1]!.checkpoint!,
      );

      const events: RawEvent[] = [];
      let logIndex = 0;
      let transactionIndex = 0;
      for (const block of blocksRows) {
        if (
          Number(block.number) >
            Number(decodeCheckpoint(supremum).blockNumber) ||
          logIndex === logsRows.length ||
          transactionIndex === transactionsRows.length
        ) {
          break;
        }

        const logs: SyncLog[] = [];
        const transactions: SyncTransaction[] = [];

        while (
          logIndex < logsRows.length &&
          logsRows[logIndex]!.blockNumber === block.number
        ) {
          const log = logsRows[logIndex]!;
          // @ts-ignore
          logs.push({
            address: log.address,
            blockHash: log.blockHash,
            blockNumber: toHex(Number(log.blockNumber)),
            data: log.data,
            logIndex: toHex(log.logIndex),
            transactionHash: log.transactionHash,
            transactionIndex: toHex(log.transactionIndex),
            topics: [
              // @ts-ignore
              log.topic0,
              log.topic1,
              log.topic2,
              log.topic3,
            ],
          });
          logIndex++;
        }

        while (
          transactionIndex < transactionsRows.length &&
          transactionsRows[transactionIndex]!.blockNumber === block.number
        ) {
          const transaction = transactionsRows[transactionIndex]!;
          transactions.push({
            hash: transaction.hash,
            blockHash: transaction.blockHash,
            blockNumber: toHex(Number(transaction.blockNumber)),
            from: transaction.from,
            to: transaction.to,
            transactionIndex: toHex(transaction.transactionIndex),
            gas: toHex(BigInt(transaction.gas)),
            input: transaction.input,
            nonce: toHex(Number(transaction.nonce)),
            value: toHex(BigInt(transaction.value)),
            r: transaction.r!,
            s: transaction.s!,
            v: toHex(BigInt(transaction.v!)),
            // @ts-ignore
            type: transaction.type,
            gasPrice: toHex(BigInt(transaction.gasPrice!)),
            maxFeePerGas: "0x0",
            maxPriorityFeePerGas: "0x0",
          });
          transactionIndex++;
        }

        events.push(
          ...buildEvents({
            sources,
            blockWithEventData: {
              // @ts-ignore
              block: {
                hash: block.hash,
                number: toHex(Number(block.number)),
                timestamp: toHex(Number(block.timestamp)),
                parentHash: block.parentHash,
                difficulty: toHex(BigInt(block.difficulty)),
                extraData: block.extraData,
                gasLimit: toHex(BigInt(block.gasLimit)),
                gasUsed: toHex(BigInt(block.gasUsed)),
                logsBloom: block.logsBloom,
                miner: block.miner,
                mixHash: block.mixHash!,
                nonce: block.nonce!,
                receiptsRoot: block.receiptsRoot,
                sha3Uncles: block.sha3Uncles!,
                size: toHex(BigInt(block.size)),
                stateRoot: block.stateRoot,
                totalDifficulty: toHex(BigInt(block.totalDifficulty!)),
                transactionsRoot: block.transactionsRoot,
              },
              logs,
              transactions,
              traces: [],
              transactionReceipts: [],
            },
            finalizedChildAddresses: new Map(),
            unfinalizedChildAddresses: new Map(),
            chainId,
          }),
        );
      }

      // TODO(kyle) maybe incorrect
      const length = Math.max(
        logsRows.length,
        blocksRows.length,
        transactionsRows.length,
      );

      let cursor: string;
      if (length !== limit) {
        cursor = to;
      } else {
        cursor = supremum;
      }

      return { events, cursor };
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
        await tx.deleteFrom("logs").where("chainId", "=", chainId).execute();
        await tx.deleteFrom("blocks").where("chainId", "=", chainId).execute();
        await tx
          .deleteFrom("rpc_request_results")
          .where("chain_id", "=", chainId)
          .execute();
        await tx.deleteFrom("traces").where("chainId", "=", chainId).execute();
        await tx
          .deleteFrom("transactions")
          .where("chainId", "=", chainId)
          .execute();
        await tx
          .deleteFrom("transactionReceipts")
          .where("chainId", "=", chainId)
          .execute();
      }),
    ),
});

const addressSQL = (
  qb: SelectQueryBuilder<PonderSyncSchema, "logs" | "blocks" | "traces", {}>,
  db: Kysely<PonderSyncSchema>,
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

// @ts-ignore
const logSQL = (
  filter: LogFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("logs")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockNumber",
      "transactionHash",
      "id as logId",
      ksql`null`.as("traceId"),
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => {
      for (const idx of [0, 1, 2, 3] as const) {
        // If it's an array of length 1, collapse it.
        const raw = filter[`topic${idx}`] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
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
    .$call((qb) => addressSQL(qb as any, db, filter.address, "address"))
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );

// @ts-ignore
const blockSQL = (
  filter: BlockFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("blocks")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "hash as blockHash",
      ksql`null`.as("transactionHash"),
      ksql`null`.as("logId"),
      ksql`null`.as("traceId"),
    ])
    .where("chainId", "=", filter.chainId)
    .$if(filter !== undefined && filter.interval !== undefined, (qb) =>
      qb.where(ksql`(number - ${filter.offset}) % ${filter.interval} = 0`),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("number", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("number", "<=", filter.toBlock!.toString()),
    );

// @ts-ignore
const transactionSQL = (
  filter: TransactionFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("transactions")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "hash as transactionHash",
      ksql`null`.as("logId"),
      ksql`null`.as("traceId"),
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(qb as any, db, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(qb as any, db, filter.toAddress, "to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where(
        db
          .selectFrom("transactionReceipts")
          .select("status")
          .where(
            "transactionReceipts.transactionHash",
            "=",
            ksql.ref("transactions.hash"),
          ),
        "=",
        "0x1",
      ),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );

// @ts-ignore
const transferSQL = (
  filter: TransferFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("traces")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "transactionHash",
      ksql`null`.as("logId"),
      "id as traceId",
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(qb as any, db, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(qb as any, db, filter.toAddress, "to"))
    .where("value", ">", "0")
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("isReverted", "=", 0),
    )
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );

// @ts-ignore
const traceSQL = (
  filter: TraceFilter,
  db: Kysely<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("traces")
    .select([
      ksql.raw(`'${index}'`).as("filterIndex"),
      "checkpoint",
      "chainId",
      "blockHash",
      "transactionHash",
      ksql`null`.as("logId"),
      "id as traceId",
    ])
    .where("chainId", "=", filter.chainId)
    .$call((qb) => addressSQL(qb as any, db, filter.fromAddress, "from"))
    .$call((qb) => addressSQL(qb as any, db, filter.toAddress, "to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("isReverted", "=", 0),
    )
    .$if(filter.callType !== undefined, (qb) =>
      qb.where("type", "=", filter.callType!),
    )
    .$if(filter.functionSelector !== undefined, (qb) => {
      if (Array.isArray(filter.functionSelector)) {
        return qb.where("functionSelector", "in", filter.functionSelector!);
      } else {
        return qb.where("functionSelector", "=", filter.functionSelector!);
      }
    })
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("blockNumber", "<=", filter.toBlock!.toString()),
    );
