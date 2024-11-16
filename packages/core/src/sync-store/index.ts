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
  type CallTraceFilter,
  type Factory,
  type Filter,
  type LogFactory,
  type LogFilter,
  isAddressFactory,
} from "@/sync/source.js";
import type { CallTrace, Log, TransactionReceipt } from "@/types/eth.js";
import type {
  LightBlock,
  SyncBlock,
  SyncCallTrace,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import type { NonNull } from "@/types/utils.js";
import { EVENT_TYPES, encodeCheckpoint } from "@/utils/checkpoint.js";
import {
  type Interval,
  intervalIntersectionMany,
  intervalUnion,
} from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import {
  type Insertable,
  type Kysely,
  type SelectQueryBuilder,
  sql as ksql,
} from "kysely";
import {
  type Address,
  type Hash,
  type Hex,
  checksumAddress,
  hexToBigInt,
  hexToNumber,
} from "viem";
import {
  type PonderSyncSchema,
  encodeBlock,
  encodeCallTrace,
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
  insertCallTraces(args: {
    callTraces: { callTrace: SyncCallTrace; block: SyncBlock }[];
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
    blockNumber: bigint;
    chainId: number;
    result: string;
  }): Promise<void>;
  getRpcRequestResult(args: {
    request: string;
    blockNumber: bigint;
    chainId: number;
  }): Promise<string | null>;
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
  insertInterval: async ({ filter, interval }) =>
    db.wrap({ method: "insertInterval" }, async () => {
      const startBlock = BigInt(interval[0]);
      const endBlock = BigInt(interval[1]);

      switch (filter.type) {
        case "log": {
          for (const fragment of buildLogFilterFragments(filter)) {
            if (isAddressFactory(filter.address)) {
              await db
                .insertInto("factoryLogFilterIntervals")
                .values({
                  factoryId: fragment.id,
                  startBlock,
                  endBlock,
                })
                .execute();
            } else {
              await db
                .insertInto("logFilterIntervals")
                .values({
                  logFilterId: fragment.id,
                  startBlock,
                  endBlock,
                })
                .execute();
            }
          }
          break;
        }

        case "block": {
          const fragment = buildBlockFilterFragment(filter);
          await db
            .insertInto("blockFilterIntervals")
            .values({
              blockFilterId: fragment.id,
              startBlock,
              endBlock,
            })
            .execute();
          break;
        }

        case "callTrace": {
          for (const fragment of buildTraceFilterFragments(filter)) {
            if (isAddressFactory(filter.toAddress)) {
              await db
                .insertInto("factoryTraceFilterIntervals")
                .values({
                  factoryId: fragment.id,
                  startBlock,
                  endBlock,
                })
                .execute();
            } else {
              await db
                .insertInto("traceFilterIntervals")
                .values({
                  traceFilterId: fragment.id,
                  startBlock,
                  endBlock,
                })
                .execute();
            }
          }
          break;
        }

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
        await db
          .insertInto(`${table!}s`)
          .values(fragment)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();

        let mergeComplete = false;
        while (mergeComplete === false) {
          await db.transaction().execute(async (tx) => {
            // This is a trick to add a LIMIT to a DELETE statement
            const existingIntervals = await tx
              .deleteFrom(`${table}Intervals`)
              .where(
                "id",
                "in",
                tx
                  .selectFrom(`${table}Intervals`)
                  .where(idCol, "=", fragment.id)
                  .select("id")
                  .orderBy("startBlock asc")
                  .limit(common.options.syncStoreMaxIntervals),
              )
              .returning(["startBlock", "endBlock"])
              .execute();

            const mergedIntervals = intervalUnion(
              existingIntervals.map((i) => [
                Number(i.startBlock),
                Number(i.endBlock),
              ]),
            );

            const mergedIntervalRows = mergedIntervals.map(
              ([startBlock, endBlock]) => ({
                [idCol as string]: fragment.id,
                startBlock: BigInt(startBlock),
                endBlock: BigInt(endBlock),
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
            ) {
              mergeComplete = true;
            }
          });
        }
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
          _intervals.map(({ startBlock, endBlock }) => [
            Number(startBlock),
            Number(endBlock),
          ]),
        );

        intervals.push(union);
      }

      return intervalIntersectionMany(intervals);
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

      /**
       * As an optimization, logs that are matched by a factory do
       * not contain a checkpoint, because not corresponding block is
       * fetched (no block.timestamp). However, when a log is matched by
       * both a log filter and a factory, the checkpoint must be included
       * in the db.
       */

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
              transaction: transactions[0]!,
              chainId,
            }),
          ).length,
      );

      for (let i = 0; i < transactions.length; i += batchSize) {
        await db
          .insertInto("transactions")
          .values(
            transactions
              .slice(i, i + batchSize)
              .map((transaction) =>
                encodeTransaction({ transaction, chainId }),
              ),
          )
          .onConflict((oc) => oc.column("hash").doNothing())
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
  insertCallTraces: async ({ callTraces, chainId }) => {
    if (callTraces.length === 0) return;
    await db.wrap({ method: "insertCallTrace" }, async () => {
      // Delete existing traces with the same `transactionHash`. Then, calculate "callTraces.checkpoint"
      // based on the ordering of "callTraces.traceAddress" and add all traces to "callTraces" table.
      const traceByTransactionHash: {
        [transactionHash: Hex]: { traces: SyncCallTrace[]; block: SyncBlock };
      } = {};

      for (const { callTrace, block } of callTraces) {
        if (traceByTransactionHash[callTrace.transactionHash] === undefined) {
          traceByTransactionHash[callTrace.transactionHash] = {
            traces: [],
            block,
          };
        }
        traceByTransactionHash[callTrace.transactionHash]!.traces.push(
          callTrace,
        );
      }

      const values: Insertable<PonderSyncSchema["callTraces"]>[] = [];

      await db.transaction().execute(async (tx) => {
        for (const transactionHash of Object.keys(traceByTransactionHash)) {
          const block = traceByTransactionHash[transactionHash as Hex]!.block;
          const traces = await tx
            .deleteFrom("callTraces")
            .returningAll()
            .where("transactionHash", "=", transactionHash as Hex)
            .where("chainId", "=", chainId)
            .execute();

          traces.push(
            // @ts-ignore
            ...traceByTransactionHash[transactionHash as Hex]!.traces.map(
              (trace) => encodeCallTrace({ trace, chainId }),
            ),
          );

          // Use lexographical sort of stringified `traceAddress`.
          traces.sort((a, b) => {
            return a.traceAddress < b.traceAddress ? -1 : 1;
          });

          for (let i = 0; i < traces.length; i++) {
            const trace = traces[i]!;

            const checkpoint = encodeCheckpoint({
              blockTimestamp: hexToNumber(block.timestamp),
              chainId: BigInt(chainId),
              blockNumber: hexToBigInt(block.number),
              transactionIndex: BigInt(trace.transactionPosition),
              eventType: EVENT_TYPES.callTraces,
              eventIndex: BigInt(i),
            });
            trace.checkpoint = checkpoint;
            values.push(trace);
          }
        }

        // Calculate `batchSize` based on how many parameters the
        // input will have
        const batchSize = Math.floor(
          common.options.databaseMaxQueryParameters /
            Object.keys(values[0]!).length,
        );

        for (let i = 0; i < values.length; i += batchSize) {
          await tx
            .insertInto("callTraces")
            .values(values.slice(i, i + batchSize))
            .onConflict((oc) => oc.column("id").doNothing())
            .execute();
        }
      });
    });
  },
  getEvents: async ({ filters, from, to, limit }) => {
    const addressSQL = (
      qb: SelectQueryBuilder<
        PonderSyncSchema,
        "logs" | "blocks" | "callTraces",
        {}
      >,
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
          ksql.raw(`'${index}'`).as("filterIndex"),
          "checkpoint",
          "chainId",
          "blockHash",
          "transactionHash",
          "id as logId",
          ksql`null`.as("callTraceId"),
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
        .$call((qb) => addressSQL(qb as any, filter.address, "address"))
        .where("blockNumber", ">=", filter.fromBlock.toString())
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("blockNumber", "<=", filter.toBlock!.toString()),
        );

    const callTraceSQL = (
      filter: CallTraceFilter,
      db: Kysely<PonderSyncSchema>,
      index: number,
    ) =>
      db
        .selectFrom("callTraces")
        .select([
          ksql.raw(`'${index}'`).as("filterIndex"),
          "checkpoint",
          "chainId",
          "blockHash",
          "transactionHash",
          ksql`null`.as("logId"),
          "id as callTraceId",
        ])
        .where("chainId", "=", filter.chainId)
        .where((eb) =>
          eb.or(
            filter.functionSelectors.map((fs) =>
              eb("callTraces.functionSelector", "=", fs),
            ),
          ),
        )
        .where(ksql`${ksql.ref("callTraces.error")} IS NULL`)
        .$call((qb) => addressSQL(qb as any, filter.fromAddress, "from"))
        .$call((qb) => addressSQL(qb, filter.toAddress, "to"))
        .where("blockNumber", ">=", filter.fromBlock.toString())
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("blockNumber", "<=", filter.toBlock!.toString()),
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
          ksql`null`.as("callTraceId"),
        ])
        .where("chainId", "=", filter.chainId)
        .$if(filter !== undefined && filter.interval !== undefined, (qb) =>
          qb.where(ksql`(number - ${filter.offset}) % ${filter.interval} = 0`),
        )
        .where("number", ">=", filter.fromBlock.toString())
        .$if(filter.toBlock !== undefined, (qb) =>
          qb.where("number", "<=", filter.toBlock!.toString()),
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
              "logs" | "callTraces" | "blocks",
              {
                filterIndex: number;
                checkpoint: string;
                chainId: number;
                blockHash: string;
                transactionHash: string;
                logId: string;
                callTraceId: string;
              }
            >
          | undefined;

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i]!;

          const _query =
            filter.type === "log"
              ? logSQL(filter, db, i)
              : filter.type === "callTrace"
                ? callTraceSQL(filter, db, i)
                : blockSQL(filter, db, i);

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
          .innerJoin("blocks", "blocks.hash", "event.blockHash")
          .select([
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
          ])
          .leftJoin("logs", "logs.id", "event.logId")
          .select([
            "logs.address as log_address",
            "logs.blockHash as log_blockHash",
            "logs.blockNumber as log_blockNumber",
            "logs.chainId as log_chainId",
            "logs.data as log_data",
            "logs.id as log_id",
            "logs.logIndex as log_logIndex",
            "logs.topic0 as log_topic0",
            "logs.topic1 as log_topic1",
            "logs.topic2 as log_topic2",
            "logs.topic3 as log_topic3",
            "logs.transactionHash as log_transactionHash",
            "logs.transactionIndex as log_transactionIndex",
          ])
          .leftJoin(
            "transactions",
            "transactions.hash",
            "event.transactionHash",
          )
          .select([
            "transactions.accessList as tx_accessList",
            "transactions.blockHash as tx_blockHash",
            "transactions.blockNumber as tx_blockNumber",
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
          ])
          .leftJoin("callTraces", "callTraces.id", "event.callTraceId")
          .select([
            "callTraces.id as callTrace_id",
            "callTraces.callType as callTrace_callType",
            "callTraces.from as callTrace_from",
            "callTraces.gas as callTrace_gas",
            "callTraces.input as callTrace_input",
            "callTraces.to as callTrace_to",
            "callTraces.value as callTrace_value",
            "callTraces.blockHash as callTrace_blockHash",
            "callTraces.blockNumber as callTrace_blockNumber",
            "callTraces.gasUsed as callTrace_gasUsed",
            "callTraces.output as callTrace_output",
            "callTraces.subtraces as callTrace_subtraces",
            "callTraces.traceAddress as callTrace_traceAddress",
            "callTraces.transactionHash as callTrace_transactionHash",
            "callTraces.transactionPosition as callTrace_transactionPosition",
          ])
          .leftJoin(
            "transactionReceipts",
            "transactionReceipts.transactionHash",
            "event.transactionHash",
          )
          .select([
            "transactionReceipts.blockHash as txr_blockHash",
            "transactionReceipts.blockNumber as txr_blockNumber",
            "transactionReceipts.contractAddress as txr_contractAddress",
            "transactionReceipts.cumulativeGasUsed as txr_cumulativeGasUsed",
            "transactionReceipts.effectiveGasPrice as txr_effectiveGasPrice",
            "transactionReceipts.from as txr_from",
            "transactionReceipts.gasUsed as txr_gasUsed",
            "transactionReceipts.logs as txr_logs",
            "transactionReceipts.logsBloom as txr_logsBloom",
            "transactionReceipts.status as txr_status",
            "transactionReceipts.to as txr_to",
            "transactionReceipts.transactionHash as txr_transactionHash",
            "transactionReceipts.transactionIndex as txr_transactionIndex",
            "transactionReceipts.type as txr_type",
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
      const hasCallTrace = row.callTrace_id !== null;
      const hasTransactionReceipt =
        (filter.type === "log" || filter.type === "callTrace") &&
        filter.includeTransactionReceipts;

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
              blockHash: row.log_blockHash,
              blockNumber: BigInt(row.log_blockNumber),
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
              transactionHash: row.log_transactionHash,
              transactionIndex: Number(row.log_transactionIndex),
            }
          : undefined,
        transaction: hasTransaction
          ? {
              blockHash: row.tx_blockHash,
              blockNumber: BigInt(row.tx_blockNumber),
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
        trace: hasCallTrace
          ? {
              id: row.callTrace_id,
              from: checksumAddress(row.callTrace_from),
              to: checksumAddress(row.callTrace_to),
              gas: BigInt(row.callTrace_gas),
              value: BigInt(row.callTrace_value),
              input: row.callTrace_input,
              output: row.callTrace_output,
              gasUsed: BigInt(row.callTrace_gasUsed),
              subtraces: row.callTrace_subtraces,
              traceAddress: JSON.parse(row.callTrace_traceAddress),
              blockHash: row.callTrace_blockHash,
              blockNumber: BigInt(row.callTrace_blockNumber),
              transactionHash: row.callTrace_transactionHash,
              transactionIndex: row.callTrace_transactionPosition,
              callType: row.callTrace_callType as CallTrace["callType"],
            }
          : undefined,
        transactionReceipt: hasTransactionReceipt
          ? {
              blockHash: row.txr_blockHash,
              blockNumber: BigInt(row.txr_blockNumber),
              contractAddress: row.txr_contractAddress
                ? checksumAddress(row.txr_contractAddress)
                : null,
              cumulativeGasUsed: BigInt(row.txr_cumulativeGasUsed),
              effectiveGasPrice: BigInt(row.txr_effectiveGasPrice),
              from: checksumAddress(row.txr_from),
              gasUsed: BigInt(row.txr_gasUsed),
              logs: JSON.parse(row.txr_logs).map((log: SyncLog) => ({
                id: `${log.blockHash}-${log.logIndex}`,
                address: checksumAddress(log.address),
                blockHash: log.blockHash,
                blockNumber: hexToBigInt(log.blockNumber),
                data: log.data,
                logIndex: hexToNumber(log.logIndex),
                removed: false,
                topics: [
                  log.topics[0] ?? null,
                  log.topics[1] ?? null,
                  log.topics[2] ?? null,
                  log.topics[3] ?? null,
                ].filter((t): t is Hex => t !== null) as [Hex, ...Hex[]] | [],
                transactionHash: log.transactionHash,
                transactionIndex: hexToNumber(log.transactionIndex),
              })),
              logsBloom: row.txr_logsBloom,
              status:
                row.txr_status === "0x1"
                  ? "success"
                  : row.txr_status === "0x0"
                    ? "reverted"
                    : (row.txr_status as TransactionReceipt["status"]),
              to: row.txr_to ? checksumAddress(row.txr_to) : null,
              transactionHash: row.txr_transactionHash,
              transactionIndex: Number(row.txr_transactionIndex),
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
        .insertInto("rpcRequestResults")
        .values({
          request,
          blockNumber,
          chainId,
          result,
        })
        .onConflict((oc) =>
          oc
            .columns(["request", "chainId", "blockNumber"])
            .doUpdateSet({ result }),
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
        .where("blockNumber", "=", blockNumber.toString())
        .executeTakeFirst();

      return result?.result ?? null;
    }),
  pruneRpcRequestResult: async ({ blocks, chainId }) =>
    db.wrap({ method: "pruneRpcRequestResult" }, async () => {
      if (blocks.length === 0) return;

      const numbers = blocks.map(({ number }) =>
        hexToBigInt(number).toString(),
      );

      await db
        .deleteFrom("rpcRequestResults")
        .where("chainId", "=", chainId)
        .where("blockNumber", "in", numbers)
        .execute();
    }),
  pruneByChain: async ({ fromBlock, chainId }) =>
    db.wrap({ method: "pruneByChain" }, () =>
      db.transaction().execute(async (tx) => {
        await tx
          .with("deleteLogFilter(logFilterId)", (qb) =>
            qb
              .selectFrom("logFilterIntervals")
              .innerJoin("logFilters", "logFilterId", "logFilters.id")
              .select("logFilterId")
              .where("chainId", "=", chainId)
              .where("startBlock", ">=", fromBlock.toString()),
          )
          .deleteFrom("logFilterIntervals")
          .where(
            "logFilterId",
            "in",
            ksql`(SELECT "logFilterId" FROM ${ksql.table("deleteLogFilter")})`,
          )
          .execute();

        await tx
          .with("updateLogFilter(logFilterId)", (qb) =>
            qb
              .selectFrom("logFilterIntervals")
              .innerJoin("logFilters", "logFilterId", "logFilters.id")
              .select("logFilterId")
              .where("chainId", "=", chainId)
              .where("startBlock", "<", fromBlock.toString())
              .where("endBlock", ">", fromBlock.toString()),
          )
          .updateTable("logFilterIntervals")
          .set({
            endBlock: fromBlock.toString(),
          })
          .where(
            "logFilterId",
            "in",
            ksql`(SELECT "logFilterId" FROM ${ksql.table("updateLogFilter")})`,
          )
          .execute();

        await tx
          .with("deleteFactoryLogFilter(factoryId)", (qb) =>
            qb
              .selectFrom("factoryLogFilterIntervals")
              .innerJoin(
                "factoryLogFilters",
                "factoryId",
                "factoryLogFilters.id",
              )

              .select("factoryId")
              .where("chainId", "=", chainId)
              .where("startBlock", ">=", fromBlock.toString()),
          )
          .deleteFrom("factoryLogFilterIntervals")
          .where(
            "factoryId",
            "in",
            ksql`(SELECT "factoryId" FROM ${ksql.table("deleteFactoryLogFilter")})`,
          )
          .execute();

        await tx
          .with("updateFactoryLogFilter(factoryId)", (qb) =>
            qb
              .selectFrom("factoryLogFilterIntervals")
              .innerJoin(
                "factoryLogFilters",
                "factoryId",
                "factoryLogFilters.id",
              )

              .select("factoryId")
              .where("chainId", "=", chainId)
              .where("startBlock", "<", fromBlock.toString())
              .where("endBlock", ">", fromBlock.toString()),
          )
          .updateTable("factoryLogFilterIntervals")
          .set({
            endBlock: BigInt(fromBlock),
          })
          .where(
            "factoryId",
            "in",
            ksql`(SELECT "factoryId" FROM ${ksql.table("updateFactoryLogFilter")})`,
          )
          .execute();

        await tx
          .with("deleteTraceFilter(traceFilterId)", (qb) =>
            qb
              .selectFrom("traceFilterIntervals")
              .innerJoin("traceFilters", "traceFilterId", "traceFilters.id")
              .select("traceFilterId")
              .where("chainId", "=", chainId)
              .where("startBlock", ">=", fromBlock.toString()),
          )
          .deleteFrom("traceFilterIntervals")
          .where(
            "traceFilterId",
            "in",
            ksql`(SELECT "traceFilterId" FROM ${ksql.table("deleteTraceFilter")})`,
          )
          .execute();

        await tx
          .with("updateTraceFilter(traceFilterId)", (qb) =>
            qb
              .selectFrom("traceFilterIntervals")
              .innerJoin("traceFilters", "traceFilterId", "traceFilters.id")
              .select("traceFilterId")
              .where("chainId", "=", chainId)
              .where("startBlock", "<", fromBlock.toString())
              .where("endBlock", ">", fromBlock.toString()),
          )
          .updateTable("traceFilterIntervals")
          .set({
            endBlock: BigInt(fromBlock),
          })
          .where(
            "traceFilterId",
            "in",
            ksql`(SELECT "traceFilterId" FROM ${ksql.table("updateTraceFilter")})`,
          )
          .execute();

        await tx
          .with("deleteFactoryTraceFilter(factoryId)", (qb) =>
            qb
              .selectFrom("factoryTraceFilterIntervals")
              .innerJoin(
                "factoryTraceFilters",
                "factoryId",
                "factoryTraceFilters.id",
              )
              .select("factoryId")
              .where("chainId", "=", chainId)
              .where("startBlock", ">=", fromBlock.toString()),
          )
          .deleteFrom("factoryTraceFilterIntervals")
          .where(
            "factoryId",
            "in",
            ksql`(SELECT "factoryId" FROM ${ksql.table("deleteFactoryTraceFilter")})`,
          )
          .execute();

        await tx
          .with("updateFactoryTraceFilter(factoryId)", (qb) =>
            qb
              .selectFrom("factoryTraceFilterIntervals")
              .innerJoin(
                "factoryTraceFilters",
                "factoryId",
                "factoryTraceFilters.id",
              )

              .select("factoryId")
              .where("chainId", "=", chainId)
              .where("startBlock", "<", fromBlock.toString())
              .where("endBlock", ">", fromBlock.toString()),
          )
          .updateTable("factoryTraceFilterIntervals")
          .set({
            endBlock: BigInt(fromBlock),
          })
          .where(
            "factoryId",
            "in",
            ksql`(SELECT "factoryId" FROM ${ksql.table("updateFactoryTraceFilter")})`,
          )
          .execute();

        await tx
          .with("deleteBlockFilter(blockFilterId)", (qb) =>
            qb
              .selectFrom("blockFilterIntervals")
              .innerJoin("blockFilters", "blockFilterId", "blockFilters.id")
              .select("blockFilterId")
              .where("chainId", "=", chainId)
              .where("startBlock", ">=", fromBlock.toString()),
          )
          .deleteFrom("blockFilterIntervals")
          .where(
            "blockFilterId",
            "in",
            ksql`(SELECT "blockFilterId" FROM ${ksql.table("deleteBlockFilter")})`,
          )
          .execute();

        await tx
          .with("updateBlockFilter(blockFilterId)", (qb) =>
            qb
              .selectFrom("blockFilterIntervals")
              .innerJoin("blockFilters", "blockFilterId", "blockFilters.id")
              .select("blockFilterId")
              .where("chainId", "=", chainId)
              .where("startBlock", "<", fromBlock.toString())
              .where("endBlock", ">", fromBlock.toString()),
          )
          .updateTable("blockFilterIntervals")
          .set({
            endBlock: BigInt(fromBlock),
          })
          .where(
            "blockFilterId",
            "in",
            ksql`(SELECT "blockFilterId" FROM ${ksql.table("updateBlockFilter")})`,
          )
          .execute();

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
          .deleteFrom("rpcRequestResults")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">=", fromBlock.toString())
          .execute();
        await tx
          .deleteFrom("callTraces")
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
