import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { RawEvent } from "@/sync/events.js";
import {
  type BlockFilterFragment,
  type LogFilterFragment,
  type TraceFilterFragment,
  buildBlockFilterFragment,
  buildLogFilterFragments,
  buildTraceFilterFragments,
} from "@/sync/fragments.js";
import {
  type BlockFilter,
  type Factory,
  type Filter,
  type LogFactory,
  type LogFilter,
  isAddressFactory,
} from "@/sync/source.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import {
  type Interval,
  intervalIntersectionMany,
  intervalUnion,
} from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { type Kysely, type SelectQueryBuilder, sql as ksql } from "kysely";
import type { Address, Hash, Hex } from "viem";
import {
  type PonderSyncSchema,
  encodeBlock,
  encodeLog,
  encodeTransaction,
  encodeTransactionReceipt,
} from "./encoding.js";

export type SyncStore = {
  insertInterval(args: {
    filter: Filter;
    interval: Interval;
  }): Promise<void>;
  getIntervals(args: {
    filter: Filter;
  }): Promise<Interval[]>;
  getChildAddresses(args: {
    filter: Factory;
    limit: number;
  }): Promise<Address[]>;
  filterChildAddresses(args: {
    filter: Factory;
    addresses: Address[];
  }): Promise<Set<Address>>;
  insertLogs(args: {
    logs: { log: SyncLog; block?: SyncBlock }[];
    chainId: number;
  }): Promise<void>;
  insertBlock(args: { block: SyncBlock; chainId: number }): Promise<void>;
  /** Return true if the block receipt is present in the database. */
  hasBlock(args: { hash: Hash }): Promise<boolean>;
  insertTransaction(args: {
    transaction: SyncTransaction;
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction is present in the database. */
  hasTransaction(args: { hash: Hash }): Promise<boolean>;
  insertTransactionReceipt(args: {
    transactionReceipt: SyncTransactionReceipt;
    chainId: number;
  }): Promise<void>;
  /** Return true if the transaction receipt is present in the database. */
  hasTransactionReceipt(args: { hash: Hash }): Promise<boolean>;
  /** Returns an ordered list of events based on the `filters` and pagination arguments. */
  getEvents(args: {
    filters: Filter[];
    from: string;
    to: string;
    limit: number;
  }): Promise<{ events: RawEvent[]; cursor: string }>;
  insertRpcRequestResult(args: {
    request: string;
    blockNumber: bigint;
    chainId: number;
    result: string;
  }): Promise<void>;
  getRpcRequestResult(args: {
    request: string;
    blockNumber: bigint;
    chainId: number;
  }): Promise<string | null>;
  // pruneByBlock,
  // pruneBySource,
  // pruneByChain,
};

const childAddressSQL = (
  childAddressLocation: LogFactory["childAddressLocation"],
) => {
  if (childAddressLocation.startsWith("offset")) {
    const childAddressOffset = Number(childAddressLocation.substring(6));
    const start = 2 + 12 * 2 + childAddressOffset * 2 + 1;
    const length = 20 * 2;
    return ksql<Hex>`'0x' || substring(data, ${start}, ${length})`;
  } else {
    const start = 2 + 12 * 2 + 1;
    const length = 20 * 2;
    return ksql<Hex>`'0x' || substring(${ksql.ref(childAddressLocation)}, ${start}, ${length})`;
  }
};

export const createSyncStore = ({
  common,
  db,
  sql,
}: {
  common: Common;
  sql: "sqlite" | "postgres";
  db: HeadlessKysely<PonderSyncSchema>;
}): SyncStore => ({
  insertInterval: async ({ filter, interval }) =>
    db.wrap({ method: "insertInterval" }, async () => {
      const intervalToBlock = (interval: Interval) => ({
        startBlock:
          sql === "sqlite" ? encodeAsText(interval[0]) : BigInt(interval[0]),
        endBlock:
          sql === "sqlite" ? encodeAsText(interval[1]) : BigInt(interval[1]),
      });

      switch (filter.type) {
        case "log":
          {
            await db.transaction().execute(async (tx) => {
              for (const fragment of buildLogFilterFragments(filter)) {
                if (isAddressFactory(filter.address)) {
                  await tx
                    .insertInto("factoryLogFilters")
                    .values(fragment as LogFilterFragment<Factory>)
                    .onConflict((oc) =>
                      oc
                        .column("id")
                        .doUpdateSet(fragment as LogFilterFragment<Factory>),
                    )
                    .execute();

                  await tx
                    .insertInto("factoryLogFilterIntervals")
                    .values({
                      factoryId: fragment.id,
                      ...intervalToBlock(interval),
                    })
                    .execute();
                } else {
                  await tx
                    .insertInto("logFilters")
                    .values(fragment)
                    .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
                    .execute();

                  await tx
                    .insertInto("logFilterIntervals")
                    .values({
                      logFilterId: fragment.id,
                      ...intervalToBlock(interval),
                    })
                    .execute();
                }
              }
            });
          }
          break;

        case "block":
          {
            const fragment = buildBlockFilterFragment(filter);
            await db.transaction().execute(async (tx) => {
              await tx
                .insertInto("blockFilters")
                .values(fragment)
                .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
                .executeTakeFirstOrThrow();

              await tx
                .insertInto("blockFilterIntervals")
                .values({
                  blockFilterId: fragment.id,
                  ...intervalToBlock(interval),
                })
                .execute();
            });
          }
          break;

        case "callTrace":
          {
            await db.transaction().execute(async (tx) => {
              for (const fragment of buildTraceFilterFragments(filter)) {
                if (isAddressFactory(filter.toAddress)) {
                  await tx
                    .insertInto("factoryTraceFilters")
                    .values(fragment as TraceFilterFragment<Factory>)
                    .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
                    .execute();

                  await tx
                    .insertInto("factoryTraceFilterIntervals")
                    .values({
                      factoryId: fragment.id,
                      ...intervalToBlock(interval),
                    })
                    .execute();
                } else {
                  await tx
                    .insertInto("traceFilters")
                    .values(fragment)
                    .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
                    .execute();

                  await tx
                    .insertInto("traceFilterIntervals")
                    .values({
                      traceFilterId: fragment.id,
                      ...intervalToBlock(interval),
                    })
                    .execute();
                }
              }
            });
          }
          break;

        default:
          never(filter);
      }
    }),
  getIntervals: async ({ filter }) =>
    db.wrap({ method: "getIntervals" }, async () => {
      const topicSQL = (
        qb: SelectQueryBuilder<
          PonderSyncSchema,
          | "logFilters"
          | "logFilterIntervals"
          | "factoryLogFilters"
          | "factoryLogFilterIntervals",
          {}
        >,
        fragment: LogFilterFragment,
      ) =>
        qb
          .where((eb) =>
            eb.or([
              eb("topic0", "is", null),
              eb("topic0", "=", fragment.topic0),
            ]),
          )
          .where((eb) =>
            eb.or([
              eb("topic1", "is", null),
              eb("topic1", "=", fragment.topic1),
            ]),
          )
          .where((eb) =>
            eb.or([
              eb("topic2", "is", null),
              eb("topic2", "=", fragment.topic2),
            ]),
          )
          .where((eb) =>
            eb.or([
              eb("topic3", "is", null),
              eb("topic3", "=", fragment.topic3),
            ]),
          );

      let fragments:
        | LogFilterFragment[]
        | TraceFilterFragment[]
        | BlockFilterFragment[];
      let table:
        | "logFilter"
        | "factoryLogFilter"
        | "traceFilter"
        | "factoryTraceFilter"
        | "blockFilter";
      let idCol:
        | "logFilterId"
        | "traceFilterId"
        | "blockFilterId"
        | "factoryId";
      let fragmentSelect: (
        fragment: any,
        qb: SelectQueryBuilder<PonderSyncSchema, keyof PonderSyncSchema, {}>,
      ) => SelectQueryBuilder<PonderSyncSchema, keyof PonderSyncSchema, {}>;

      switch (filter.type) {
        case "log":
          {
            if (isAddressFactory(filter.address)) {
              fragments = buildLogFilterFragments(filter);
              table = "factoryLogFilter";
              idCol = "factoryId";
              // @ts-ignore
              fragmentSelect = (fragment: LogFilterFragment<LogFactory>, qb) =>
                qb
                  .where("address", "=", fragment.address)
                  .where("eventSelector", "=", fragment.eventSelector)
                  .where(
                    "childAddressLocation",
                    "=",
                    fragment.childAddressLocation,
                  )
                  .where(
                    "includeTransactionReceipts",
                    ">=",
                    fragment.includeTransactionReceipts,
                  )
                  .$call((qb) => topicSQL(qb, fragment));
            } else {
              fragments = buildLogFilterFragments(filter);
              table = "logFilter";
              idCol = "logFilterId";
              // @ts-ignore
              fragmentSelect = (fragment: LogFilterFragment<undefined>, qb) =>
                qb
                  .where((eb) =>
                    eb.or([
                      eb("address", "is", null),
                      eb("address", "=", fragment.address),
                    ]),
                  )
                  .where(
                    "includeTransactionReceipts",
                    ">=",
                    fragment.includeTransactionReceipts,
                  )
                  .$call((qb) => topicSQL(qb, fragment));
            }
          }
          break;

        case "block":
          {
            fragments = [buildBlockFilterFragment(filter)];
            table = "blockFilter";
            idCol = "blockFilterId";
            fragmentSelect = (fragment, qb) =>
              qb.where("blockFilterId", "=", fragment.id);
          }
          break;

        case "callTrace":
          {
            if (isAddressFactory(filter.toAddress)) {
              fragments = buildTraceFilterFragments(filter);
              table = "factoryTraceFilter";
              idCol = "factoryId";
              fragmentSelect = (fragment: TraceFilterFragment<Factory>, qb) =>
                qb
                  .where("address", "=", fragment.address)
                  .where("eventSelector", "=", fragment.eventSelector)
                  .where(
                    "childAddressLocation",
                    "=",
                    fragment.childAddressLocation,
                  )
                  .where((eb) =>
                    eb.or([
                      eb("fromAddress", "is", null),
                      eb("fromAddress", "=", fragment.fromAddress),
                    ]),
                  );
            } else {
              fragments = buildTraceFilterFragments(filter);
              table = "traceFilter";
              idCol = "traceFilterId";
              fragmentSelect = (fragment: TraceFilterFragment<undefined>, qb) =>
                qb
                  .where((eb) =>
                    eb.or([
                      eb("fromAddress", "is", null),
                      eb("fromAddress", "=", fragment.fromAddress),
                    ]),
                  )
                  .where((eb) =>
                    eb.or([
                      eb("toAddress", "is", null),
                      eb("toAddress", "=", fragment.toAddress),
                    ]),
                  );
            }
          }
          break;

        default:
          never(filter);
      }

      // First, attempt to merge overlapping and adjacent intervals.
      for (const fragment of fragments!) {
        await db.transaction().execute(async (tx) => {
          while (true) {
            const { id } = await tx
              .insertInto(`${table}s`)
              .values(fragment)
              .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
              .returningAll()
              .executeTakeFirstOrThrow();

            // This is a trick to add a LIMIT to a DELETE statement
            const existingIntervals = await tx
              .deleteFrom(`${table}Intervals`)
              .where(
                "id",
                "in",
                tx
                  .selectFrom(`${table}Intervals`)
                  .where(idCol, "=", id)
                  .select("id")
                  .limit(common.options.syncStoreMaxIntervals),
              )
              .returning(["startBlock", "endBlock"])
              .execute();

            const mergedIntervals = intervalUnion(
              existingIntervals.map((i) =>
                sql === "sqlite"
                  ? [
                      Number(decodeToBigInt(i.startBlock as string)),
                      Number(decodeToBigInt(i.endBlock as string)),
                    ]
                  : [Number(i.startBlock), Number(i.endBlock)],
              ),
            );

            const mergedIntervalRows = mergedIntervals.map(
              ([startBlock, endBlock]) => ({
                [idCol as string]: id,
                startBlock:
                  sql === "sqlite"
                    ? encodeAsText(startBlock)
                    : BigInt(startBlock),
                endBlock:
                  sql === "sqlite" ? encodeAsText(endBlock) : BigInt(endBlock),
              }),
            );

            if (mergedIntervalRows.length > 0) {
              await tx
                .insertInto(`${table}Intervals`)
                .values(mergedIntervalRows)
                .execute();
            }

            if (
              mergedIntervalRows.length === common.options.syncStoreMaxIntervals
            ) {
              // This occurs when there are too many non-mergeable ranges with the same logFilterId. Should be almost impossible.
              throw new NonRetryableError(
                `'${table}Intervals' table for chain '${fragment.chainId}' has reached an unrecoverable level of fragmentation.`,
              );
            }

            if (
              existingIntervals.length !== common.options.syncStoreMaxIntervals
            )
              break;
          }
        });
      }

      const intervals: Interval[][] = [];
      for (const fragment of fragments!) {
        const _intervals = await db
          .selectFrom(`${table!}Intervals`)
          .innerJoin(`${table!}s`, idCol!, `${table!}s.id`)
          .$call((qb) => fragmentSelect(fragment, qb as any))
          .where("chainId", "=", fragment.chainId)
          .select(["startBlock", "endBlock"])
          .execute();

        const union = intervalUnion(
          _intervals.map(({ startBlock, endBlock }) =>
            sql === "sqlite"
              ? [
                  Number(decodeToBigInt(startBlock as string)),
                  Number(decodeToBigInt(endBlock as string)),
                ]
              : [Number(startBlock), Number(endBlock)],
          ),
        );

        intervals.push(union);
      }

      return intervalIntersectionMany(intervals);
    }),
  getChildAddresses: ({ filter, limit }) =>
    db.wrap({ method: "getChildAddresses" }, async () => {
      return await db
        .selectFrom("logs")
        .select(childAddressSQL(filter.childAddressLocation).as("address"))
        .where("address", "=", filter.address)
        .where("topic0", "=", filter.eventSelector)
        .where("chainId", "=", filter.chainId)
        .orderBy("id asc")
        .limit(limit)
        .execute()
        .then((addresses) => addresses.map(({ address }) => address));
    }),
  filterChildAddresses: ({ filter, addresses }) =>
    db.wrap({ method: "filterChildAddresses" }, async () => {
      const result = await db
        .with("childAddresses", (db) =>
          db
            .selectFrom("logs")
            .select(childAddressSQL(filter.childAddressLocation).as("address"))
            .where("address", "=", filter.address)
            .where("topic0", "=", filter.eventSelector)
            .where("chainId", "=", filter.chainId),
        )
        .selectNoFrom(
          addresses.map((a, i) =>
            ksql
              .raw(`CASE WHEN '${a}' IN "childAddresses" THEN 1 ELSE 0 END`)
              .as(String(i)),
          ),
        )
        .executeTakeFirstOrThrow();

      const set = new Set<Address>();

      for (let i = 0; i < addresses.length; i++) {
        if (result[String(i)] === 1) set.add(addresses[i]!);
      }

      return set;
    }),
  insertLogs: async ({ logs, chainId }) =>
    db.wrap({ method: "insertLogs" }, async () => {
      await db
        .insertInto("logs")
        .values(
          logs.map(({ log, block }) => encodeLog({ log, block, chainId, sql })),
        )
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    }),
  insertBlock: async ({ block, chainId }) =>
    db.wrap({ method: "insertBlock" }, async () => {
      await db
        .insertInto("blocks")
        .values(encodeBlock({ block, chainId, sql }))
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();
    }),
  hasBlock: async ({ hash }) =>
    db.wrap({ method: "hasBlock" }, async () => {
      return await db
        .selectFrom("blocks")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTransaction: async ({ transaction, chainId }) =>
    db.wrap({ method: "insertTransaction" }, async () => {
      await db
        .insertInto("transactions")
        .values(encodeTransaction({ transaction, chainId, sql }))
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();
    }),
  hasTransaction: async ({ hash }) =>
    db.wrap({ method: "hasTransaction" }, async () => {
      return await db
        .selectFrom("transactions")
        .select("hash")
        .where("hash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  insertTransactionReceipt: async ({ transactionReceipt, chainId }) =>
    db.wrap({ method: "insertTransactionReceipt" }, async () => {
      await db
        .insertInto("transactionReceipts")
        .values(encodeTransactionReceipt({ transactionReceipt, chainId, sql }))
        .onConflict((oc) => oc.column("transactionHash").doNothing())
        .execute();
    }),
  hasTransactionReceipt: async ({ hash }) =>
    db.wrap({ method: "hasTransactionReceipt" }, async () => {
      return await db
        .selectFrom("transactionReceipts")
        .select("transactionHash")
        .where("transactionHash", "=", hash)
        .executeTakeFirst()
        .then((result) => result !== undefined);
    }),
  getEvents: async ({ filters, from, to, limit }) => {
    const filterMap = new Map<number, Filter>();

    const addressSQL = <
      T extends SelectQueryBuilder<PonderSyncSchema, "logs", {}>,
    >(
      qb: T,
      address: LogFilter["address"],
    ): T => {
      if (typeof address === "string")
        return qb.where("address", "=", address) as T;
      if (Array.isArray(address))
        return qb.where("address", "in", address) as T;
      if (isAddressFactory(address)) {
        // log address filter
        return qb.where(
          "address",
          "in",
          db
            .selectFrom("logs")
            .select(
              childAddressSQL(address.childAddressLocation).as("childAddress"),
            )
            .where("address", "=", address.address)
            .where("topic0", "=", address.eventSelector)
            .where("chainId", "=", address.chainId),
        ) as T;
      }
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
          ksql.raw(`'${index}'`).as("filterIndex"),
          "checkpoint",
          "chainId",
          "blockHash",
          "transactionHash",
          "id as logId",
        ])
        .where("chainId", "=", filter.chainId)
        .$if(filter.topics !== undefined, (qb) => {
          for (const idx_ of [0, 1, 2, 3]) {
            const idx = idx_ as 0 | 1 | 2 | 3;
            // If it's an array of length 1, collapse it.
            const raw = filter.topics![idx] ?? null;
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
        .$call((qb) => addressSQL(qb, filter.address))
        .where(
          "blockNumber",
          ">=",
          sql === "sqlite"
            ? encodeAsText(filter.fromBlock)
            : BigInt(filter.fromBlock),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where(
            "blockNumber",
            "<=",
            sql === "sqlite"
              ? encodeAsText(filter.toBlock!)
              : BigInt(filter.toBlock!),
          ),
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
          "checkpoint",
          "chainId",
          "hash as blockHash",
          ksql`null`.as("transactionHash"),
          ksql`null`.as("logId"),
        ])
        .where("chainId", "=", filter.chainId)
        .$if(filter !== undefined && filter.interval !== undefined, (qb) =>
          qb.where(ksql`(number - ${filter.offset}) % ${filter.interval} = 0`),
        )
        .$if(filter.fromBlock !== undefined, (qb) =>
          qb.where(
            "number",
            ">=",
            sql === "sqlite"
              ? encodeAsText(filter.fromBlock!)
              : BigInt(filter.fromBlock!),
          ),
        )
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where(
            "number",
            "<=",
            sql === "sqlite"
              ? encodeAsText(filter.toBlock!)
              : BigInt(filter.toBlock!),
          ),
        );

    const events = await db.wrap({ method: "getEvents" }, async () => {
      let query: ReturnType<typeof logSQL> | undefined;

      for (const filter of filters) {
        const index = filterMap.size;
        filterMap.set(index, filter);

        if (query === undefined) {
          // @ts-ignore
          query =
            filter.type === "log"
              ? logSQL(filter, db, index)
              : blockSQL(filter, db, index);
        } else {
          query = query.unionAll(
            // @ts-ignore
            filter.type === "log" ? logSQL(filter, db) : blockSQL(filter, db),
          );
        }
      }

      return await db
        .with("event", () => query!)
        .selectFrom("event")
        .innerJoin("blocks", "blocks.hash", "event.blockHash")
        .leftJoin("logs", "logs.id", "event.logId")
        .leftJoin("transactions", "transactions.hash", "event.transactionHash")
        .selectAll()
        .where("event.checkpoint", ">", from)
        .where("event.checkpoint", "<=", to)
        .orderBy("event.checkpoint", "asc")
        .orderBy("event.filterIndex", "asc")
        .limit(limit)
        .execute();
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
        .insertInto("rpcRequestResults")
        .values({
          request,
          blockNumber:
            sql === "sqlite" ? encodeAsText(blockNumber) : blockNumber,
          chainId,
          result,
        })
        .onConflict((oc) =>
          oc.columns(["request", "chainId", "blockNumber"]).doNothing(),
        )
        .execute();
    }),
  getRpcRequestResult: async ({ request, blockNumber, chainId }) =>
    db.wrap({ method: "getRpcRequestResult" }, async () => {
      const result = await db
        .selectFrom("rpcRequestResults")
        .select("result")
        .where("request", "=", request)
        .where("chainId", "=", chainId)
        .where(
          "blockNumber",
          "=",
          sql === "sqlite" ? encodeAsText(blockNumber) : blockNumber,
        )
        .executeTakeFirst();

      return result?.result ?? null;
    }),
});
