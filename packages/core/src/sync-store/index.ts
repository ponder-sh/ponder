import { randomBytes } from "node:crypto";
import type { Common } from "@/common/common.js";
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
  getEventsStream(args: {
    filters: Filter[];
    from: string;
    to: string;
  }): AsyncGenerator<{ events: RawEvent[]; cursor: string }>;
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

  getEventsStream: async function* ({ filters, from, to }) {
    type EventSchema = PonderSyncSchema & {
      [K in `filter_${number}`]: EventRow;
    };
    const filterCte = (db: QueryCreator<EventSchema>, i: number) => {
      const filter = filters[i]!;
      // return logSQL(filter as LogFilter, db, i);
      return filter.type === "log"
        ? logSQL(filter, db, i)
        : filter.type === "block"
          ? blockSQL(filter, db, i)
          : filter.type === "transaction"
            ? transactionSQL(filter, db, i)
            : filter.type === "transfer"
              ? transferSQL(filter, db, i)
              : traceSQL(filter, db, i);
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
      .selectAll()
      .where("event.checkpoint", ">", from)
      .where("event.checkpoint", "<=", to)
      .orderBy("event.checkpoint", "asc");
    // .orderBy("event.filter_index", "asc");
    // .orderBy("event.block_number", "asc")
    // .orderBy("event.tx_index", "asc")
    // .orderBy("event.trace_index", "asc")

    try {
      // console.log(query.compile().sql);
      const planText = await query
        .limit(10000)
        .explain("text", ksql`analyze, buffers`);
      const prettyPlanText = planText
        .map((line) => line["QUERY PLAN"])
        .join("\n");
      console.log(prettyPlanText);
      // const planJson = await query.explain("json", ksql`analyze`);
      // const prettyPlanJson = JSON.stringify(planJson, null, 2);
      // console.log(prettyPlanJson);
    } catch (e) {
      console.error(e);
    }

    const compiledQuery = query.compile();

    const chunkSize = 10_000;

    const queryId = { queryId: randomBytes(16).toString("hex") };
    const stream = db.getExecutor().stream(compiledQuery, chunkSize, queryId);

    for await (const result of stream) {
      const { rows } = result;

      const events = rows.map((row) => {
        const filter = filters[row.filter_index]!;
        return rowToEvent(row as EventRow, filter);
      });

      let cursor: string;
      if (events.length !== chunkSize) {
        cursor = to;
      } else {
        cursor = events[events.length - 1]!.checkpoint!;
      }

      yield { events, cursor };
    }
  },
  getEvents: async ({ filters, from, to, limit }) => {
    type EventSchema = PonderSyncSchema & {
      [K in `filter_${number}`]: EventRow;
    };
    const filterCte = (db: QueryCreator<EventSchema>, i: number) => {
      const filter = filters[i]!;
      // return logSQL(filter as LogFilter, db, i);
      return filter.type === "log"
        ? logSQL(filter, db, i)
        : filter.type === "block"
          ? blockSQL(filter, db, i)
          : filter.type === "transaction"
            ? transactionSQL(filter, db, i)
            : filter.type === "transfer"
              ? transferSQL(filter, db, i)
              : traceSQL(filter, db, i);
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
      .selectAll()
      .where("event.checkpoint", ">", from)
      .where("event.checkpoint", "<=", to)
      .orderBy("event.checkpoint", "asc")
      .orderBy("event.filter_index", "asc")
      // .orderBy("event.block_number", "asc")
      // .orderBy("event.tx_index", "asc")
      // .orderBy("event.trace_index", "asc")
      .limit(limit);

    const rows = await db.wrap(
      {
        method: "getEvents",
        shouldRetry(error) {
          return error.message.includes("statement timeout") === false;
        },
      },
      async () => {
        try {
          // console.log(query.compile().sql);

          const planText = await query.explain("text", ksql`analyze, buffers`);
          const prettyPlanText = planText
            .map((line) => line["QUERY PLAN"])
            .join("\n");
          console.log(prettyPlanText);

          // const planJson = await query.explain("json", ksql`analyze`);
          // const prettyPlanJson = JSON.stringify(planJson, null, 2);
          // console.log(prettyPlanJson);
        } catch (e) {
          console.error(e);
        }

        return await query.execute();
      },
    );

    const events = rows.map((row) => {
      const filter = filters[row.filter_index]!;
      return rowToEvent(row as EventRow, filter);
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

type EventRow = {
  filter_index: number;
  checkpoint: string;
  chain_id: number;

  block_number: string;
  block_hash: Hex;
  block_parentHash: Hex;
  block_timestamp: string;
  // block_body: any;

  tx_index: number;
  tx_hash: Hex;
  tx_from: Hex;
  tx_to: Hex;
  // tx_body: any;

  tx_receipt_status: Hex;
  // tx_receipt_body: any;

  log_index: number;
  log_address: Hex;
  log_data: Hex;
  log_topic0: Hex;
  log_topic1: Hex;
  log_topic2: Hex;
  log_topic3: Hex;

  trace_index: number;
  trace_callType: Trace["type"];
  trace_from: Hex;
  trace_to: Hex;
  trace_value: Hex;
  trace_functionSelector: Hex;
  trace_isReverted: boolean;
  // trace_body: any;
};

function rowToEvent(row: EventRow, filter: Filter) {
  const hasLog = row.log_address !== null;
  const hasTransaction = row.tx_from !== null;
  const hasTrace = row.trace_from !== null;
  const hasTransactionReceipt = shouldGetTransactionReceipt(filter);

  return {
    chainId: row.chain_id,
    checkpoint: row.checkpoint,
    sourceIndex: row.filter_index,
    block: {
      number: BigInt(row.block_number),
      hash: row.block_hash,
      parentHash: row.block_parentHash,
      timestamp: BigInt(row.block_timestamp),
      // baseFeePerGas:
      //   row.block_body.baseFeePerGas !== null
      //     ? BigInt(row.block_body.baseFeePerGas)
      //     : null,
      // difficulty: BigInt(row.block_body.difficulty),
      // extraData: row.block_body.extraData,
      // gasLimit: BigInt(row.block_body.gasLimit),
      // gasUsed: BigInt(row.block_body.gasUsed),
      // logsBloom: row.block_body.logsBloom,
      // miner: checksumAddress(row.block_body.miner),
      // mixHash: row.block_body.mixHash,
      // nonce: row.block_body.nonce,
      // receiptsRoot: row.block_body.receiptsRoot,
      // sha3Uncles: row.block_body.sha3Uncles,
      // size: BigInt(row.block_body.size),
      // stateRoot: row.block_body.stateRoot,
      // totalDifficulty:
      //   row.block_body.totalDifficulty !== null
      //     ? BigInt(row.block_body.totalDifficulty)
      //     : null,
      // transactionsRoot: row.block_body.transactionsRoot,
    },
    log: hasLog
      ? {
          // id: `${chainId}-${row.event_block_number}-${row.event_log_index}`,
          id: `${row.block_hash}-${numberToHex(row.log_index)}`,
          address: checksumAddress(row.log_address!),
          data: row.log_data,
          logIndex: Number(row.log_index),
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
          hash: row.tx_hash,
          transactionIndex: Number(row.tx_index),
          from: checksumAddress(row.tx_from),
          to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
          // gas: BigInt(row.tx_body.gas),
          // input: row.tx_body.input,
          // nonce: Number(row.tx_body.nonce),
          // r: row.tx_body.r,
          // s: row.tx_body.s,
          // value: BigInt(row.tx_body.value),
          // v: row.tx_body.v !== null ? BigInt(row.tx_body.v) : null,
          // ...(row.tx_body.type === "0x0"
          //   ? {
          //       type: "legacy",
          //       gasPrice: BigInt(row.tx_body.gasPrice!),
          //     }
          //   : row.tx_body.type === "0x1"
          //     ? {
          //         type: "eip2930",
          //         gasPrice: BigInt(row.tx_body.gasPrice!),
          //         accessList: JSON.parse(row.tx_body.accessList!),
          //       }
          //     : row.tx_body.type === "0x2"
          //       ? {
          //           type: "eip1559",
          //           maxFeePerGas: BigInt(row.tx_body.maxFeePerGas!),
          //           maxPriorityFeePerGas: BigInt(
          //             row.tx_body.maxPriorityFeePerGas!,
          //           ),
          //         }
          //       : row.tx_body.type === "0x7e"
          //         ? {
          //             type: "deposit",
          //             maxFeePerGas:
          //               row.tx_body.maxFeePerGas !== null
          //                 ? BigInt(row.tx_body.maxFeePerGas!)
          //                 : undefined,
          //             maxPriorityFeePerGas:
          //               row.tx_body.maxPriorityFeePerGas !== null
          //                 ? BigInt(row.tx_body.maxPriorityFeePerGas!)
          //                 : undefined,
          //           }
          //         : {
          //             type: row.tx_body.type,
          //           }),
        }
      : undefined,
    trace: hasTrace
      ? {
          // id: `${chainId}-${row.event_block_number}-${row.event_transaction_index}-${row.event_trace_index}`,
          id: `${row.tx_hash}-${row.trace_index}`,
          traceIndex: Number(row.trace_index),
          type: row.trace_callType as Trace["type"],
          from: checksumAddress(row.trace_from),
          to: checksumAddress(row.trace_to),
          value: BigInt(row.trace_value),
          // gas: BigInt(row.trace_body.gas),
          // gasUsed: BigInt(row.trace_body.gasUsed),
          // input: row.trace_body.input,
          // output: row.trace_body.output,
          // subcalls: Number(row.trace_body.subcalls),
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
          // contractAddress: row.tx_receipt_body.contractAddress
          //   ? checksumAddress(row.tx_receipt_body.contractAddress)
          //   : null,
          // cumulativeGasUsed: BigInt(row.tx_receipt_body.cumulativeGasUsed),
          // effectiveGasPrice: BigInt(row.tx_receipt_body.effectiveGasPrice),
          // from: checksumAddress(row.tx_receipt_body.from),
          // gasUsed: BigInt(row.tx_receipt_body.gasUsed),
          // logsBloom: row.tx_receipt_body.logsBloom,
          // to: row.tx_receipt_body.to
          //   ? checksumAddress(row.tx_receipt_body.to)
          //   : null,
          // type:
          //   row.tx_receipt_body.type === "0x0"
          //     ? "legacy"
          //     : row.tx_receipt_body.type === "0x1"
          //       ? "eip2930"
          //       : row.tx_receipt_body.type === "0x2"
          //         ? "eip1559"
          //         : row.tx_receipt_body.type === "0x7e"
          //           ? "deposit"
          //           : row.tx_receipt_body.type,
        }
      : undefined,
  } satisfies RawEvent;
}

const logSQL = (
  filter: LogFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("logs")
    // Filters
    .$call((qb) => {
      for (const idx of [0, 1, 2, 3] as const) {
        // If it's an array of length 1, collapse it.
        const raw = filter[`topic${idx}`] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0]! : raw;
        if (Array.isArray(topic)) {
          qb = qb.where(`logs.topic${idx}`, "in", topic);
        } else {
          qb = qb.where(`logs.topic${idx}`, "=", topic);
        }
      }
      return qb;
    })
    .$call((qb) => addressSQL(db, qb, filter.address, "logs.address"))
    .$if(filter.fromBlock !== undefined, (qb) =>
      qb.where("logs.blockNumber", ">=", filter.fromBlock!.toString()),
    )
    .$if(filter.toBlock !== undefined, (qb) =>
      qb.where("logs.blockNumber", "<=", filter.toBlock!.toString()),
    )
    // Joins and selects
    // Base
    .select([
      ksql`${index.toString()}::integer`.$castTo<number>().as("filter_index"),
      "logs.checkpoint as checkpoint",
      "logs.chainId as chain_id",
    ])
    // Blocks
    .$call((qb) =>
      qb
        .leftJoin("blocks", (join) =>
          join.onRef("logs.blockNumber", "=", "blocks.number"),
        )
        .select([
          "blocks.number as block_number",
          "blocks.hash as block_hash",
          "blocks.parentHash as block_parentHash",
          "blocks.timestamp as block_timestamp",
          // "blocks.body as block_body",
        ]),
    )
    // Transactions
    .$call((qb) =>
      qb
        .leftJoin("transactions", (join) =>
          join
            .onRef("logs.blockNumber", "=", "transactions.blockNumber")
            .onRef(
              "logs.transactionIndex",
              "=",
              "transactions.transactionIndex",
            ),
        )
        .select([
          "transactions.transactionIndex as tx_index",
          "transactions.hash as tx_hash",
          "transactions.from as tx_from",
          "transactions.to as tx_to",
          // "transactions.body as tx_body",
        ]),
    )
    // Transaction receipts
    .$if(shouldGetTransactionReceipt(filter), (qb) =>
      qb
        .leftJoin("transactionReceipts", (join) =>
          join
            .onRef("logs.blockNumber", "=", "transactionReceipts.blockNumber")
            .onRef(
              "logs.transactionIndex",
              "=",
              "transactionReceipts.transactionIndex",
            ),
        )
        .select([
          "transactionReceipts.status as tx_receipt_status",
          // "transactionReceipts.body as tx_receipt_body",
        ]),
    )
    .$if(!shouldGetTransactionReceipt(filter), (qb) =>
      qb.select([
        ksql`null::text`.as("tx_receipt_status"),
        // ksql`null::jsonb`.as("tx_receipt_body"),
      ]),
    )
    // Logs
    .$call((qb) =>
      qb.select([
        "logs.logIndex as log_index",
        "logs.address as log_address",
        "logs.data as log_data",
        "logs.topic0 as log_topic0",
        "logs.topic1 as log_topic1",
        "logs.topic2 as log_topic2",
        "logs.topic3 as log_topic3",
      ]),
    )
    // Traces
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("trace_index"),
        ksql`null::text`.as("trace_callType"),
        ksql`null::text`.as("trace_from"),
        ksql`null::text`.as("trace_to"),
        ksql`null::numeric(78,0)`.as("trace_value"),
        ksql`null::text`.as("trace_functionSelector"),
        ksql`null::integer`.as("trace_isReverted"),
        // ksql`null::jsonb`.as("trace_body"),
      ]),
    )
    .orderBy("checkpoint", "asc");

const blockSQL = (
  filter: BlockFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
) =>
  db
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
      ksql`${index.toString()}::integer`.$castTo<number>().as("filter_index"),
      "blocks.checkpoint as checkpoint",
      "blocks.chainId as chain_id",
    ])
    // Blocks
    .$call((qb) =>
      qb.select([
        "blocks.number as block_number",
        "blocks.hash as block_hash",
        "blocks.parentHash as block_parentHash",
        "blocks.timestamp as block_timestamp",
        // "blocks.body as block_body",
      ]),
    )
    // Transactions
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("tx_index"),
        ksql`null::text`.as("tx_hash"),
        ksql`null::text`.as("tx_from"),
        ksql`null::text`.as("tx_to"),
        // ksql`null::jsonb`.as("tx_body"),
      ]),
    )
    // Transaction receipts
    .$call((qb) =>
      qb.select([
        ksql`null::text`.as("tx_receipt_status"),
        // ksql`null::jsonb`.as("tx_receipt_body"),
      ]),
    )
    // Logs
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("log_index"),
        ksql`null::text`.as("log_address"),
        ksql`null::text`.as("log_data"),
        ksql`null::text`.as("log_topic0"),
        ksql`null::text`.as("log_topic1"),
        ksql`null::text`.as("log_topic2"),
        ksql`null::text`.as("log_topic3"),
      ]),
    )
    // Traces
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("trace_index"),
        ksql`null::text`.as("trace_callType"),
        ksql`null::text`.as("trace_from"),
        ksql`null::text`.as("trace_to"),
        ksql`null::numeric(78,0)`.as("trace_value"),
        ksql`null::text`.as("trace_functionSelector"),
        ksql`null::integer`.as("trace_isReverted"),
        // ksql`null::jsonb`.as("trace_body"),
      ]),
    );

const transactionSQL = (
  filter: TransactionFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
) =>
  db
    .selectFrom("transactions")
    // Filters
    .$call((qb) => addressSQL(db, qb, filter.fromAddress, "transactions.from"))
    .$call((qb) => addressSQL(db, qb, filter.toAddress, "transactions.to"))
    .$if(filter.includeReverted === false, (qb) =>
      qb.where("transactionReceipts.status", "=", "0x1"),
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
      ksql`${index.toString()}::integer`.$castTo<number>().as("filter_index"),
      "transactions.checkpoint as checkpoint",
      "transactions.chainId as chain_id",
    ])
    // Blocks
    .$call((qb) =>
      qb
        .leftJoin("blocks", (join) =>
          join.onRef("transactions.blockNumber", "=", "blocks.number"),
        )
        .select([
          "blocks.number as block_number",
          "blocks.hash as block_hash",
          "blocks.parentHash as block_parentHash",
          "blocks.timestamp as block_timestamp",
          // "blocks.body as block_body",
        ]),
    )
    // Transactions
    .$call((qb) =>
      qb.select([
        "transactions.transactionIndex as tx_index",
        "transactions.hash as tx_hash",
        "transactions.from as tx_from",
        "transactions.to as tx_to",
        // "transactions.body as tx_body",
      ]),
    )
    // Transaction receipts (always include for now, using an inner join)
    .$call((qb) =>
      qb
        .innerJoin("transactionReceipts", (join) =>
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
        .select([
          "transactionReceipts.status as tx_receipt_status",
          // "transactionReceipts.body as tx_receipt_body",
        ]),
    )
    // Logs
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("log_index"),
        ksql`null::text`.as("log_address"),
        ksql`null::text`.as("log_data"),
        ksql`null::text`.as("log_topic0"),
        ksql`null::text`.as("log_topic1"),
        ksql`null::text`.as("log_topic2"),
        ksql`null::text`.as("log_topic3"),
      ]),
    )
    // Traces
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("trace_index"),
        ksql`null::text`.as("trace_callType"),
        ksql`null::text`.as("trace_from"),
        ksql`null::text`.as("trace_to"),
        ksql`null::numeric(78,0)`.as("trace_value"),
        ksql`null::text`.as("trace_functionSelector"),
        ksql`null::integer`.as("trace_isReverted"),
        // ksql`null::jsonb`.as("trace_body"),
      ]),
    );

const transferSQL = (
  filter: TransferFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
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
      ksql`${index.toString()}::integer`.$castTo<number>().as("filter_index"),
      "traces.checkpoint as checkpoint",
      "traces.chainId as chain_id",
    ])
    // Blocks
    .$call((qb) =>
      qb
        .leftJoin("blocks", (join) =>
          join.onRef("traces.blockNumber", "=", "blocks.number"),
        )
        .select([
          "blocks.number as block_number",
          "blocks.hash as block_hash",
          "blocks.parentHash as block_parentHash",
          "blocks.timestamp as block_timestamp",
          // "blocks.body as block_body",
        ]),
    )
    // Transactions
    .$call((qb) =>
      qb
        .leftJoin("transactions", (join) =>
          join
            .onRef("traces.blockNumber", "=", "transactions.blockNumber")
            .onRef(
              "traces.transactionIndex",
              "=",
              "transactions.transactionIndex",
            ),
        )
        .select([
          "transactions.transactionIndex as tx_index",
          "transactions.hash as tx_hash",
          "transactions.from as tx_from",
          "transactions.to as tx_to",
          // "transactions.body as tx_body",
        ]),
    )
    // Transaction receipts
    .$if(shouldGetTransactionReceipt(filter), (qb) =>
      qb
        .leftJoin("transactionReceipts", (join) =>
          join
            .onRef("traces.blockNumber", "=", "transactionReceipts.blockNumber")
            .onRef(
              "traces.transactionIndex",
              "=",
              "transactionReceipts.transactionIndex",
            ),
        )
        .select([
          "transactionReceipts.status as tx_receipt_status",
          // "transactionReceipts.body as tx_receipt_body",
        ]),
    )
    .$if(!shouldGetTransactionReceipt(filter), (qb) =>
      qb.select([
        ksql`null::text`.as("tx_receipt_status"),
        ksql`null::jsonb`.as("tx_receipt_body"),
      ]),
    )
    // Logs
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("log_index"),
        ksql`null::text`.as("log_address"),
        ksql`null::text`.as("log_data"),
        ksql`null::text`.as("log_topic0"),
        ksql`null::text`.as("log_topic1"),
        ksql`null::text`.as("log_topic2"),
        ksql`null::text`.as("log_topic3"),
      ]),
    )
    // Traces
    .$call((qb) =>
      qb.select([
        "traces.trace_index as trace_index",
        "traces.type as trace_callType",
        "traces.from as trace_from",
        "traces.to as trace_to",
        "traces.value as trace_value",
        "traces.functionSelector as trace_functionSelector",
        "traces.isReverted as trace_isReverted",
        // "traces.body as trace_body",
      ]),
    );

const traceSQL = (
  filter: TraceFilter,
  db: QueryCreator<PonderSyncSchema>,
  index: number,
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
      ksql`${index.toString()}::integer`.$castTo<number>().as("filter_index"),
      "traces.checkpoint as checkpoint",
      "traces.chainId as chain_id",
    ])
    // Blocks
    .$call((qb) =>
      qb
        .leftJoin("blocks", (join) =>
          join.onRef("traces.blockNumber", "=", "blocks.number"),
        )
        .select([
          "blocks.number as block_number",
          "blocks.hash as block_hash",
          "blocks.parentHash as block_parentHash",
          "blocks.timestamp as block_timestamp",
          // "blocks.body as block_body",
        ]),
    )
    // Transactions
    .$call((qb) =>
      qb
        .leftJoin("transactions", (join) =>
          join
            .onRef("traces.blockNumber", "=", "transactions.blockNumber")
            .onRef(
              "traces.transactionIndex",
              "=",
              "transactions.transactionIndex",
            ),
        )
        .select([
          "transactions.transactionIndex as tx_index",
          "transactions.hash as tx_hash",
          "transactions.from as tx_from",
          "transactions.to as tx_to",
          // "transactions.body as tx_body",
        ]),
    )
    // Transaction receipts
    .$if(shouldGetTransactionReceipt(filter), (qb) =>
      qb
        .leftJoin("transactionReceipts", (join) =>
          join
            .onRef("traces.blockNumber", "=", "transactionReceipts.blockNumber")
            .onRef(
              "traces.transactionIndex",
              "=",
              "transactionReceipts.transactionIndex",
            ),
        )
        .select([
          "transactionReceipts.status as tx_receipt_status",
          // "transactionReceipts.body as tx_receipt_body",
        ]),
    )
    .$if(!shouldGetTransactionReceipt(filter), (qb) =>
      qb.select([
        ksql`null::text`.as("tx_receipt_status"),
        ksql`null::jsonb`.as("tx_receipt_body"),
      ]),
    )
    // Logs
    .$call((qb) =>
      qb.select([
        ksql`null::integer`.as("log_index"),
        ksql`null::text`.as("log_address"),
        ksql`null::text`.as("log_data"),
        ksql`null::text`.as("log_topic0"),
        ksql`null::text`.as("log_topic1"),
        ksql`null::text`.as("log_topic2"),
        ksql`null::text`.as("log_topic3"),
      ]),
    )
    // Traces
    .$call((qb) =>
      qb.select([
        "traces.trace_index as trace_index",
        "traces.type as trace_callType",
        "traces.from as trace_from",
        "traces.to as trace_to",
        "traces.value as trace_value",
        "traces.functionSelector as trace_functionSelector",
        "traces.isReverted as trace_isReverted",
        // "traces.body as trace_body",
      ]),
    );

const logFactorySQL = (
  qb: SelectQueryBuilder<PonderSyncSchema, any, {}>,
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
    .where("topic0", "=", factory.eventSelector);

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
    return qb.where(
      column,
      "in",
      db.selectFrom("logs").$call((qb) => logFactorySQL(qb, address)),
    );
  }
  if (Array.isArray(address)) return qb.where(column, "in", address);

  return qb;
};
