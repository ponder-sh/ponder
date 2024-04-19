import {
  type EventSource,
  type FactoryCriteria,
  type FactorySource,
  type LogFilterCriteria,
  type LogSource,
  sourceIsFactory,
  sourceIsLog,
} from "@/config/sources.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { SyncLog } from "@/sync/index.js";
import type { Log } from "@/types/eth.js";
import type { NonNull } from "@/types/utils.js";
import {
  type Checkpoint,
  EVENT_TYPES,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import {
  buildFactoryFragments,
  buildLogFilterFragments,
} from "@/utils/fragments.js";
import { intervalIntersectionMany, intervalUnion } from "@/utils/interval.js";
import { range } from "@/utils/range.js";
import {
  type ExpressionBuilder,
  type Transaction as KyselyTransaction,
  sql,
} from "kysely";
import {
  type Hex,
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  type RpcTransactionReceipt,
  type TransactionReceipt,
  checksumAddress,
  hexToBigInt,
  hexToNumber,
} from "viem";
import type { RawEvent, SyncStore } from "../store.js";
import { rpcToSqliteTransactionReceipt } from "./encoding.js";
import {
  type SyncStoreTables,
  rpcToSqliteBlock,
  rpcToSqliteLog,
  rpcToSqliteTransaction,
} from "./encoding.js";

export class SqliteSyncStore implements SyncStore {
  kind = "sqlite" as const;
  db: HeadlessKysely<SyncStoreTables>;

  constructor({ db }: { db: HeadlessKysely<SyncStoreTables> }) {
    this.db = db;
  }

  insertLogFilterInterval = async ({
    chainId,
    logFilter,
    block: rpcBlock,
    transactions: rpcTransactions,
    transactionReceipts: rpcTransactionReceipts,
    logs: rpcLogs,
    interval,
  }: {
    chainId: number;
    logFilter: LogFilterCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    transactionReceipts?: RpcTransactionReceipt[];
    logs: RpcLog[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    return this.db.wrap({ method: "insertLogFilterInterval" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("blocks")
          .values({ ...rpcToSqliteBlock(rpcBlock), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();

        if (rpcTransactions.length > 0) {
          const transactions = rpcTransactions.map((rpcTransaction) => ({
            ...rpcToSqliteTransaction(rpcTransaction),
            chainId,
          }));
          await tx
            .insertInto("transactions")
            .values(transactions)
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();
        }

        if (
          rpcTransactionReceipts !== undefined &&
          rpcTransactionReceipts.length > 0
        ) {
          const transactionReceipts = rpcTransactionReceipts.map(
            (rpcTransactionReceipt) => ({
              ...rpcToSqliteTransactionReceipt(rpcTransactionReceipt),
              chainId,
            }),
          );
          await tx
            .insertInto("transactionReceipts")
            .values(transactionReceipts)
            .onConflict((oc) => oc.column("transactionHash").doNothing())
            .execute();
        }

        if (rpcLogs.length > 0) {
          const logs = rpcLogs.map((rpcLog) => ({
            ...rpcToSqliteLog(rpcLog),
            chainId,
            checkpoint: this.createCheckpoint(rpcLog, rpcBlock, chainId),
          }));
          await tx
            .insertInto("logs")
            .values(logs)
            .onConflict((oc) =>
              oc.column("id").doUpdateSet((eb) => ({
                checkpoint: eb.ref("excluded.checkpoint"),
              })),
            )
            .execute();
        }

        await this._insertLogFilterInterval({
          tx,
          chainId,
          logFilters: [logFilter],
          interval,
        });
      });
    });
  };

  getLogFilterIntervals = async ({
    chainId,
    logFilter,
  }: {
    chainId: number;
    logFilter: LogFilterCriteria;
  }) => {
    return this.db.wrap({ method: "getLogFilterIntervals" }, async () => {
      const fragments = buildLogFilterFragments({ ...logFilter, chainId });

      // First, attempt to merge overlapping and adjacent intervals.
      await Promise.all(
        fragments.map(async (fragment) => {
          return await this.db.transaction().execute(async (tx) => {
            const { id: logFilterId } = await tx
              .insertInto("logFilters")
              .values(fragment)
              .onConflict((oc) => oc.doUpdateSet(fragment))
              .returningAll()
              .executeTakeFirstOrThrow();

            const existingIntervalRows = await tx
              .deleteFrom("logFilterIntervals")
              .where("logFilterId", "=", logFilterId)
              .returningAll()
              .execute();

            const mergedIntervals = intervalUnion(
              existingIntervalRows.map((i) => [
                Number(decodeToBigInt(i.startBlock)),
                Number(decodeToBigInt(i.endBlock)),
              ]),
            );

            const mergedIntervalRows = mergedIntervals.map(
              ([startBlock, endBlock]) => ({
                logFilterId,
                startBlock: encodeAsText(startBlock),
                endBlock: encodeAsText(endBlock),
              }),
            );

            if (mergedIntervalRows.length > 0) {
              await tx
                .insertInto("logFilterIntervals")
                .values(mergedIntervalRows)
                .execute();
            }

            return mergedIntervals;
          });
        }),
      );

      const intervals = await this.db
        .with(
          "logFilterFragments(fragmentId, fragmentAddress, fragmentTopic0, fragmentTopic1, fragmentTopic2, fragmentTopic3, fragmentIncludeTransactionReceipts)",
          () =>
            sql`( values ${sql.join(
              fragments.map(
                (f) =>
                  sql`( ${sql.val(f.id)}, ${sql.val(f.address)}, ${sql.val(
                    f.topic0,
                  )}, ${sql.val(f.topic1)}, ${sql.val(f.topic2)}, ${sql.val(
                    f.topic3,
                  )}, ${sql.lit(f.includeTransactionReceipts)} )`,
              ),
            )} )`,
        )
        .selectFrom("logFilterIntervals")
        .innerJoin("logFilters", "logFilterId", "logFilters.id")
        .innerJoin("logFilterFragments", (join) => {
          let baseJoin = join.on((eb) =>
            eb.or([
              eb("address", "is", null),
              eb("fragmentAddress", "=", sql.ref("address")),
            ]),
          );
          baseJoin = baseJoin.on((eb) =>
            eb(
              "fragmentIncludeTransactionReceipts",
              "<=",
              sql.ref("includeTransactionReceipts"),
            ),
          );
          for (const idx_ of range(0, 4)) {
            baseJoin = baseJoin.on((eb) => {
              const idx = idx_ as 0 | 1 | 2 | 3;
              return eb.or([
                eb(`topic${idx}`, "is", null),
                eb(`fragmentTopic${idx}`, "=", sql.ref(`topic${idx}`)),
              ]);
            });
          }

          return baseJoin;
        })
        .select(["fragmentId", "startBlock", "endBlock"])
        .where("chainId", "=", chainId)
        .execute();

      const intervalsByFragmentId = intervals.reduce(
        (acc, cur) => {
          const { fragmentId, startBlock, endBlock } = cur;
          (acc[fragmentId] ||= []).push([
            Number(decodeToBigInt(startBlock)),
            Number(decodeToBigInt(endBlock)),
          ]);
          return acc;
        },
        {} as Record<string, [number, number][]>,
      );

      const intervalsForEachFragment = fragments.map((f) =>
        intervalUnion(intervalsByFragmentId[f.id] ?? []),
      );
      return intervalIntersectionMany(intervalsForEachFragment);
    });
  };

  insertFactoryChildAddressLogs = async ({
    chainId,
    logs: rpcLogs,
  }: {
    chainId: number;
    logs: RpcLog[];
  }) => {
    return this.db.wrap(
      { method: "insertFactoryChildAddressLogs" },
      async () => {
        if (rpcLogs.length > 0) {
          const logs = rpcLogs.map((rpcLog) => ({
            ...rpcToSqliteLog(rpcLog),
            chainId,
          }));
          await this.db
            .insertInto("logs")
            .values(logs)
            .onConflict((oc) => oc.column("id").doNothing())
            .execute();
        }
      },
    );
  };

  async *getFactoryChildAddresses({
    chainId,
    fromBlock,
    toBlock,
    factory,
    pageSize = 500,
  }: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
    factory: FactoryCriteria;
    pageSize?: number;
  }) {
    const { address, eventSelector, childAddressLocation } = factory;
    const selectChildAddressExpression =
      buildFactoryChildAddressSelectExpression({ childAddressLocation });

    const baseQuery = this.db
      .selectFrom("logs")
      .select(["id", selectChildAddressExpression.as("childAddress")])
      .where("chainId", "=", chainId)
      .where("address", "=", address)
      .where("topic0", "=", eventSelector)
      .where("blockNumber", ">=", encodeAsText(fromBlock))
      .where("blockNumber", "<=", encodeAsText(toBlock))
      .orderBy("id", "asc")
      .limit(pageSize);

    let cursor: string | undefined = undefined;

    while (true) {
      let query = baseQuery;
      if (cursor !== undefined) query = query.where("id", ">", cursor);

      const batch = await this.db.wrap(
        { method: "getFactoryChildAddresses" },
        () => query.execute(),
      );

      if (batch.length > 0) {
        yield batch.map((a) => a.childAddress);
      }

      // If the batch is less than the page size, there are no more pages.
      if (batch.length < pageSize) break;
      // Otherwise, set the cursor to the last block number in the batch.
      cursor = batch[batch.length - 1].id;
    }
  }

  insertFactoryLogFilterInterval = async ({
    chainId,
    factory,
    block: rpcBlock,
    transactions: rpcTransactions,
    transactionReceipts: rpcTransactionReceipts,
    logs: rpcLogs,
    interval,
  }: {
    chainId: number;
    factory: FactoryCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    transactionReceipts?: RpcTransactionReceipt[];
    logs: RpcLog[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    return this.db.wrap(
      { method: "insertFactoryLogFilterInterval" },
      async () => {
        await this.db.transaction().execute(async (tx) => {
          await tx
            .insertInto("blocks")
            .values({ ...rpcToSqliteBlock(rpcBlock), chainId })
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();

          if (rpcTransactions.length > 0) {
            const transactions = rpcTransactions.map((rpcTransaction) => ({
              ...rpcToSqliteTransaction(rpcTransaction),
              chainId,
            }));
            await tx
              .insertInto("transactions")
              .values(transactions)
              .onConflict((oc) => oc.column("hash").doNothing())
              .execute();
          }

          if (
            rpcTransactionReceipts !== undefined &&
            rpcTransactionReceipts.length > 0
          ) {
            const transactionReceipts = rpcTransactionReceipts.map(
              (rpcTransactionReceipt) => ({
                ...rpcToSqliteTransactionReceipt(rpcTransactionReceipt),
                chainId,
              }),
            );
            await tx
              .insertInto("transactionReceipts")
              .values(transactionReceipts)
              .onConflict((oc) => oc.column("transactionHash").doNothing())
              .execute();
          }

          if (rpcLogs.length > 0) {
            const logs = rpcLogs.map((rpcLog) => ({
              ...rpcToSqliteLog(rpcLog),
              chainId,
              checkpoint: this.createCheckpoint(rpcLog, rpcBlock, chainId),
            }));
            await tx
              .insertInto("logs")
              .values(logs)
              .onConflict((oc) =>
                oc.column("id").doUpdateSet((eb) => ({
                  checkpoint: eb.ref("excluded.checkpoint"),
                })),
              )
              .execute();
          }

          await this._insertFactoryLogFilterInterval({
            tx,
            chainId,
            factories: [factory],
            interval,
          });
        });
      },
    );
  };

  getFactoryLogFilterIntervals = async ({
    chainId,
    factory,
  }: {
    chainId: number;
    factory: FactoryCriteria;
  }) => {
    return this.db.wrap(
      { method: "getFactoryLogFilterIntervals" },
      async () => {
        const fragments = buildFactoryFragments({ ...factory, chainId });

        await Promise.all(
          fragments.map(async (fragment) => {
            return await this.db.transaction().execute(async (tx) => {
              const { id: factoryId } = await tx
                .insertInto("factories")
                .values(fragment)
                .onConflict((oc) => oc.doUpdateSet(fragment))
                .returningAll()
                .executeTakeFirstOrThrow();

              const existingIntervals = await tx
                .deleteFrom("factoryLogFilterIntervals")
                .where("factoryId", "=", factoryId)
                .returningAll()
                .execute();

              const mergedIntervals = intervalUnion(
                existingIntervals.map((i) => [
                  Number(decodeToBigInt(i.startBlock)),
                  Number(decodeToBigInt(i.endBlock)),
                ]),
              );

              const mergedIntervalRows = mergedIntervals.map(
                ([startBlock, endBlock]) => ({
                  factoryId,
                  startBlock: encodeAsText(startBlock),
                  endBlock: encodeAsText(endBlock),
                }),
              );

              if (mergedIntervalRows.length > 0) {
                await tx
                  .insertInto("factoryLogFilterIntervals")
                  .values(mergedIntervalRows)
                  .execute();
              }

              return mergedIntervals;
            });
          }),
        );

        const intervals = await this.db
          .with(
            "factoryFilterFragments(fragmentId, fragmentAddress, fragmentEventSelector, fragmentChildAddressLocation, fragmentTopic0, fragmentTopic1, fragmentTopic2, fragmentTopic3, fragmentIncludeTransactionReceipts)",
            () =>
              sql`( values ${sql.join(
                fragments.map(
                  (f) =>
                    sql`( ${sql.val(f.id)}, ${sql.val(f.address)}, ${sql.val(
                      f.eventSelector,
                    )}, ${sql.val(f.childAddressLocation)}, ${sql.val(
                      f.topic0,
                    )}, ${sql.val(f.topic1)}, ${sql.val(f.topic2)}, ${sql.val(
                      f.topic3,
                    )}, ${sql.lit(f.includeTransactionReceipts)} )`,
                ),
              )} )`,
          )
          .selectFrom("factoryLogFilterIntervals")
          .innerJoin("factories", "factoryId", "factories.id")
          .innerJoin("factoryFilterFragments", (join) => {
            let baseJoin = join.on((eb) =>
              eb.and([
                eb("fragmentAddress", "=", sql.ref("address")),
                eb("fragmentEventSelector", "=", sql.ref("eventSelector")),
                eb(
                  "fragmentChildAddressLocation",
                  "<=",
                  sql.ref("childAddressLocation"),
                ),
              ]),
            );
            baseJoin = baseJoin.on((eb) =>
              eb(
                "fragmentIncludeTransactionReceipts",
                "=",
                sql.ref("includeTransactionReceipts"),
              ),
            );
            for (const idx_ of range(0, 4)) {
              baseJoin = baseJoin.on((eb) => {
                const idx = idx_ as 0 | 1 | 2 | 3;
                return eb.or([
                  eb(`topic${idx}`, "is", null),
                  eb(`fragmentTopic${idx}`, "=", sql.ref(`topic${idx}`)),
                ]);
              });
            }

            return baseJoin;
          })
          .select(["fragmentId", "startBlock", "endBlock"])
          .where("chainId", "=", chainId)
          .execute();

        const intervalsByFragmentId = intervals.reduce(
          (acc, cur) => {
            const { fragmentId, startBlock, endBlock } = cur;
            (acc[fragmentId] ||= []).push([
              Number(startBlock),
              Number(endBlock),
            ]);
            return acc;
          },
          {} as Record<string, [number, number][]>,
        );

        const intervalsForEachFragment = fragments.map((f) =>
          intervalUnion(intervalsByFragmentId[f.id] ?? []),
        );
        return intervalIntersectionMany(intervalsForEachFragment);
      },
    );
  };

  insertRealtimeBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    transactionReceipts: rpcTransactionReceipts,
    logs: rpcLogs,
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    transactionReceipts?: RpcTransactionReceipt[];
    logs: RpcLog[];
  }) => {
    return this.db.wrap({ method: "insertRealtimeBlock" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("blocks")
          .values({ ...rpcToSqliteBlock(rpcBlock), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();

        if (rpcTransactions.length > 0) {
          const transactions = rpcTransactions.map((rpcTransaction) => ({
            ...rpcToSqliteTransaction(rpcTransaction),
            chainId,
          }));
          await tx
            .insertInto("transactions")
            .values(transactions)
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();
        }

        if (
          rpcTransactionReceipts !== undefined &&
          rpcTransactionReceipts.length > 0
        ) {
          const transactionReceipts = rpcTransactionReceipts.map(
            (rpcTransactionReceipt) => ({
              ...rpcToSqliteTransactionReceipt(rpcTransactionReceipt),
              chainId,
            }),
          );
          await tx
            .insertInto("transactionReceipts")
            .values(transactionReceipts)
            .onConflict((oc) => oc.column("transactionHash").doNothing())
            .execute();
        }

        if (rpcLogs.length > 0) {
          const logs = rpcLogs.map((rpcLog) => ({
            ...rpcToSqliteLog(rpcLog),
            chainId,
            checkpoint: this.createCheckpoint(rpcLog, rpcBlock, chainId),
          }));
          await tx
            .insertInto("logs")
            .values(logs)
            .onConflict((oc) =>
              oc.column("id").doUpdateSet((eb) => ({
                checkpoint: eb.ref("excluded.checkpoint"),
              })),
            )
            .execute();
        }
      });
    });
  };

  private createCheckpoint = (
    rpcLog: RpcLog,
    block: RpcBlock,
    chainId: number,
  ) => {
    if (block.number === null) {
      throw new Error("Number is missing from RPC block");
    }
    if (rpcLog.transactionIndex === null) {
      throw new Error("Transaction index is missing from RPC log");
    }
    if (rpcLog.logIndex === null) {
      throw new Error("Log index is missing from RPC log");
    }
    return encodeCheckpoint({
      blockTimestamp: Number(BigInt(block.timestamp)),
      chainId,
      blockNumber: Number(BigInt(block.number)),
      transactionIndex: Number(BigInt(rpcLog.transactionIndex)),
      eventType: EVENT_TYPES.logs,
      eventIndex: Number(BigInt(rpcLog.logIndex)),
    });
  };

  insertRealtimeInterval = async ({
    chainId,
    logFilters,
    factories,
    interval,
  }: {
    chainId: number;
    logFilters: LogFilterCriteria[];
    factories: FactoryCriteria[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    return this.db.wrap({ method: "insertRealtimeInterval" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await this._insertLogFilterInterval({
          tx,
          chainId,
          logFilters: [
            ...logFilters,
            ...factories.map((f) => ({
              address: f.address,
              topics: [f.eventSelector],
              includeTransactionReceipts: f.includeTransactionReceipts,
            })),
          ],
          interval,
        });

        await this._insertFactoryLogFilterInterval({
          tx,
          chainId,
          factories,
          interval,
        });
      });
    });
  };

  deleteRealtimeData = async ({
    chainId,
    fromBlock: fromBlock_,
  }: {
    chainId: number;
    fromBlock: bigint;
  }) => {
    return this.db.wrap({ method: "deleteRealtimeData" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        const fromBlock = encodeAsText(fromBlock_);

        await tx
          .deleteFrom("logs")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">", fromBlock)
          .execute();
        await tx
          .deleteFrom("rpcRequestResults")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">", fromBlock)
          .execute();
      });
    });
  };

  /** SYNC HELPER METHODS */

  private _insertLogFilterInterval = async ({
    tx,
    chainId,
    logFilters,
    interval: { startBlock, endBlock },
  }: {
    tx: KyselyTransaction<SyncStoreTables>;
    chainId: number;
    logFilters: LogFilterCriteria[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    const logFilterFragments = logFilters.flatMap((logFilter) =>
      buildLogFilterFragments({ ...logFilter, chainId }),
    );

    await Promise.all(
      logFilterFragments.map(async (logFilterFragment) => {
        const { id: logFilterId } = await tx
          .insertInto("logFilters")
          .values(logFilterFragment)
          .onConflict((oc) => oc.doUpdateSet(logFilterFragment))
          .returningAll()
          .executeTakeFirstOrThrow();

        await tx
          .insertInto("logFilterIntervals")
          .values({
            logFilterId,
            startBlock: encodeAsText(startBlock),
            endBlock: encodeAsText(endBlock),
          })
          .execute();
      }),
    );
  };

  private _insertFactoryLogFilterInterval = async ({
    tx,
    chainId,
    factories,
    interval: { startBlock, endBlock },
  }: {
    tx: KyselyTransaction<SyncStoreTables>;
    chainId: number;
    factories: FactoryCriteria[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    const factoryFragments = factories.flatMap((factory) =>
      buildFactoryFragments({ ...factory, chainId }),
    );

    await Promise.all(
      factoryFragments.map(async (fragment) => {
        const { id: factoryId } = await tx
          .insertInto("factories")
          .values(fragment)
          .onConflict((oc) => oc.doUpdateSet(fragment))
          .returningAll()
          .executeTakeFirstOrThrow();

        await tx
          .insertInto("factoryLogFilterIntervals")
          .values({
            factoryId,
            startBlock: encodeAsText(startBlock),
            endBlock: encodeAsText(endBlock),
          })
          .execute();
      }),
    );
  };

  /** CONTRACT READS */

  insertRpcRequestResult = async ({
    blockNumber,
    chainId,
    request,
    result,
  }: {
    blockNumber: bigint;
    chainId: number;
    request: string;
    result: string;
  }) => {
    return this.db.wrap({ method: "insertRpcRequestResult" }, async () => {
      await this.db
        .insertInto("rpcRequestResults")
        .values({
          request,
          blockNumber: encodeAsText(blockNumber),
          chainId,
          result,
        })
        .onConflict((oc) => oc.doUpdateSet({ result }))
        .execute();
    });
  };

  getRpcRequestResult = async ({
    blockNumber,
    chainId,
    request,
  }: {
    blockNumber: bigint;
    chainId: number;
    request: string;
  }) => {
    return this.db.wrap({ method: "getRpcRequestResult" }, async () => {
      const rpcRequestResult = await this.db
        .selectFrom("rpcRequestResults")
        .selectAll()
        .where("blockNumber", "=", encodeAsText(blockNumber))
        .where("chainId", "=", chainId)
        .where("request", "=", request)
        .executeTakeFirst();

      return rpcRequestResult
        ? {
            ...rpcRequestResult,
            blockNumber: decodeToBigInt(rpcRequestResult.blockNumber),
          }
        : null;
    });
  };

  async *getLogEvents({
    sources,
    fromCheckpoint,
    toCheckpoint,
    limit,
  }: {
    sources: Pick<
      EventSource,
      "id" | "startBlock" | "endBlock" | "criteria" | "type"
    >[];
    fromCheckpoint: Checkpoint;
    toCheckpoint: Checkpoint;
    limit: number;
  }) {
    let cursor = encodeCheckpoint(fromCheckpoint);
    const encodedToCheckpoint = encodeCheckpoint(toCheckpoint);

    const sourcesById = sources.reduce<{
      [sourceId: EventSource["id"]]: (typeof sources)[number];
    }>((acc, cur) => {
      acc[cur.id] = cur;
      return acc;
    }, {});

    while (true) {
      const events = await this.db.wrap(
        { method: "getLogEvents" },
        async () => {
          // Query a batch of logs.
          const requestedLogs = await this.db
            .with(
              "sources(source_id)",
              () =>
                sql`( values ${sql.join(
                  sources.map((source) => sql`( ${sql.val(source.id)} )`),
                )} )`,
            )
            .selectFrom("logs")
            .innerJoin("blocks", "blocks.hash", "logs.blockHash")
            .innerJoin(
              "transactions",
              "transactions.hash",
              "logs.transactionHash",
            )
            // TODO(kyle) do this programmatically
            .leftJoin(
              "transactionReceipts",
              "transactionReceipts.transactionHash",
              "logs.transactionHash",
            )
            .innerJoin("sources", (join) => join.onTrue())
            .where((eb) => {
              const logFilterCmprs = sources
                .filter(sourceIsLog)
                .map((logFilter) => {
                  const exprs = this.buildLogFilterCmprs({ eb, logFilter });
                  exprs.push(eb("source_id", "=", logFilter.id));
                  return eb.and(exprs);
                });

              const factoryCmprs = sources
                .filter(sourceIsFactory)
                .map((factory) => {
                  const exprs = this.buildFactoryCmprs({ eb, factory });
                  exprs.push(eb("source_id", "=", factory.id));
                  return eb.and(exprs);
                });

              return eb.or([...logFilterCmprs, ...factoryCmprs]);
            })
            .select([
              "source_id",

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
              "logs.checkpoint as log_checkpoint",

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
            .where("logs.checkpoint", ">", cursor)
            .where("logs.checkpoint", "<=", encodedToCheckpoint)
            .orderBy("logs.checkpoint", "asc")
            .limit(limit + 1)
            .execute();

          return requestedLogs.map((_row) => {
            // Without this cast, the block_ and tx_ fields are all nullable
            // which makes this very annoying. Should probably add a runtime check
            // that those fields are indeed present before continuing here.
            const row = _row as NonNull<(typeof requestedLogs)[number]>;
            return {
              chainId: row.log_chainId,
              sourceId: row.source_id,
              encodedCheckpoint: row.log_checkpoint,
              log: {
                address: checksumAddress(row.log_address),
                blockHash: row.log_blockHash,
                blockNumber: decodeToBigInt(row.log_blockNumber),
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
              },
              block: {
                baseFeePerGas: row.block_baseFeePerGas
                  ? decodeToBigInt(row.block_baseFeePerGas)
                  : null,
                difficulty: decodeToBigInt(row.block_difficulty),
                extraData: row.block_extraData,
                gasLimit: decodeToBigInt(row.block_gasLimit),
                gasUsed: decodeToBigInt(row.block_gasUsed),
                hash: row.block_hash,
                logsBloom: row.block_logsBloom,
                miner: checksumAddress(row.block_miner),
                mixHash: row.block_mixHash,
                nonce: row.block_nonce,
                number: decodeToBigInt(row.block_number),
                parentHash: row.block_parentHash,
                receiptsRoot: row.block_receiptsRoot,
                sha3Uncles: row.block_sha3Uncles,
                size: decodeToBigInt(row.block_size),
                stateRoot: row.block_stateRoot,
                timestamp: decodeToBigInt(row.block_timestamp),
                totalDifficulty: row.block_totalDifficulty
                  ? decodeToBigInt(row.block_totalDifficulty)
                  : null,
                transactionsRoot: row.block_transactionsRoot,
              },
              transaction: {
                blockHash: row.tx_blockHash,
                blockNumber: decodeToBigInt(row.tx_blockNumber),
                from: checksumAddress(row.tx_from),
                gas: decodeToBigInt(row.tx_gas),
                hash: row.tx_hash,
                input: row.tx_input,
                nonce: Number(row.tx_nonce),
                r: row.tx_r,
                s: row.tx_s,
                to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
                transactionIndex: Number(row.tx_transactionIndex),
                value: decodeToBigInt(row.tx_value),
                v: row.tx_v ? decodeToBigInt(row.tx_v) : null,
                ...(row.tx_type === "0x0"
                  ? {
                      type: "legacy",
                      gasPrice: decodeToBigInt(row.tx_gasPrice),
                    }
                  : row.tx_type === "0x1"
                    ? {
                        type: "eip2930",
                        gasPrice: decodeToBigInt(row.tx_gasPrice),
                        accessList: JSON.parse(row.tx_accessList),
                      }
                    : row.tx_type === "0x2"
                      ? {
                          type: "eip1559",
                          maxFeePerGas: decodeToBigInt(row.tx_maxFeePerGas),
                          maxPriorityFeePerGas: decodeToBigInt(
                            row.tx_maxPriorityFeePerGas,
                          ),
                        }
                      : row.tx_type === "0x7e"
                        ? {
                            type: "deposit",
                            maxFeePerGas: row.tx_maxFeePerGas
                              ? decodeToBigInt(row.tx_maxFeePerGas)
                              : undefined,
                            maxPriorityFeePerGas: row.tx_maxPriorityFeePerGas
                              ? decodeToBigInt(row.tx_maxPriorityFeePerGas)
                              : undefined,
                          }
                        : {
                            type: row.tx_type,
                          }),
              },
              transactionReceipt: sourcesById[row.source_id].criteria
                .includeTransactionReceipts
                ? {
                    blockHash: row.txr_blockHash,
                    blockNumber: decodeToBigInt(row.txr_blockNumber),
                    contractAddress: row.txr_contractAddress
                      ? checksumAddress(row.txr_contractAddress)
                      : null,
                    cumulativeGasUsed: decodeToBigInt(
                      row.txr_cumulativeGasUsed,
                    ),
                    effectiveGasPrice: decodeToBigInt(
                      row.txr_effectiveGasPrice,
                    ),
                    from: checksumAddress(row.txr_from),
                    gasUsed: decodeToBigInt(row.txr_gasUsed),
                    logs: JSON.parse(row.txr_logs).map((log: SyncLog) => ({
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
                      ].filter((t): t is Hex => t !== null) as
                        | [Hex, ...Hex[]]
                        | [],
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
        },
      );

      const hasNextPage = events.length === limit + 1;

      if (!hasNextPage) {
        yield events;
        break;
      } else {
        events.pop();
        cursor = events[events.length - 1].encodedCheckpoint;
        yield events;
      }
    }
  }

  async getLastEventCheckpoint({
    sources,
    fromCheckpoint,
    toCheckpoint,
  }: {
    sources: Pick<
      EventSource,
      "id" | "startBlock" | "endBlock" | "criteria" | "type"
    >[];
    fromCheckpoint: Checkpoint;
    toCheckpoint: Checkpoint;
  }): Promise<Checkpoint | undefined> {
    return this.db.wrap({ method: "getLastEventCheckpoint" }, async () => {
      const checkpoint = await this.db
        .selectFrom("logs")
        .where((eb) => {
          const logFilterCmprs = sources
            .filter(sourceIsLog)
            .map((logFilter) => {
              const exprs = this.buildLogFilterCmprs({ eb, logFilter });
              return eb.and(exprs);
            });

          const factoryCmprs = sources
            .filter(sourceIsFactory)
            .map((factory) => {
              const exprs = this.buildFactoryCmprs({ eb, factory });
              return eb.and(exprs);
            });

          return eb.or([...logFilterCmprs, ...factoryCmprs]);
        })
        .select("checkpoint")
        .where("logs.checkpoint", ">", encodeCheckpoint(fromCheckpoint))
        .where("logs.checkpoint", "<=", encodeCheckpoint(toCheckpoint))
        .orderBy("logs.checkpoint", "desc")
        .executeTakeFirst();

      return checkpoint
        ? checkpoint.checkpoint
          ? decodeCheckpoint(checkpoint.checkpoint)
          : undefined
        : undefined;
    });
  }

  private buildLogFilterCmprs = ({
    eb,
    logFilter,
  }: {
    eb: ExpressionBuilder<any, any>;
    logFilter: LogSource;
  }) => {
    const exprs = [];

    exprs.push(eb("logs.chainId", "=", logFilter.chainId));

    if (logFilter.criteria.address) {
      // If it's an array of length 1, collapse it.
      const address =
        Array.isArray(logFilter.criteria.address) &&
        logFilter.criteria.address.length === 1
          ? logFilter.criteria.address[0]
          : logFilter.criteria.address;
      if (Array.isArray(address)) {
        exprs.push(eb.or(address.map((a) => eb("logs.address", "=", a))));
      } else {
        exprs.push(eb("logs.address", "=", address));
      }
    }

    if (logFilter.criteria.topics) {
      for (const idx_ of range(0, 4)) {
        const idx = idx_ as 0 | 1 | 2 | 3;
        // If it's an array of length 1, collapse it.
        const raw = logFilter.criteria.topics[idx] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        if (Array.isArray(topic)) {
          exprs.push(eb.or(topic.map((a) => eb(`logs.topic${idx}`, "=", a))));
        } else {
          exprs.push(eb(`logs.topic${idx}`, "=", topic));
        }
      }
    }

    if (logFilter.startBlock !== undefined && logFilter.startBlock !== 0)
      exprs.push(
        eb("logs.blockNumber", ">=", encodeAsText(logFilter.startBlock)),
      );
    if (logFilter.endBlock)
      exprs.push(
        eb("logs.blockNumber", "<=", encodeAsText(logFilter.endBlock)),
      );

    return exprs;
  };

  private buildFactoryCmprs = ({
    eb,
    factory,
  }: {
    eb: ExpressionBuilder<any, any>;
    factory: FactorySource;
  }) => {
    const exprs = [];

    exprs.push(eb("logs.chainId", "=", factory.chainId));

    const selectChildAddressExpression =
      buildFactoryChildAddressSelectExpression({
        childAddressLocation: factory.criteria.childAddressLocation,
      });

    exprs.push(
      eb(
        "logs.address",
        "in",
        eb
          .selectFrom("logs")
          .select(selectChildAddressExpression.as("childAddress"))
          .where("chainId", "=", factory.chainId)
          .where("address", "=", factory.criteria.address)
          .where("topic0", "=", factory.criteria.eventSelector),
      ),
    );

    if (factory.criteria.topics) {
      for (const idx_ of range(0, 4)) {
        const idx = idx_ as 0 | 1 | 2 | 3;
        // If it's an array of length 1, collapse it.
        const raw = factory.criteria.topics[idx] ?? null;
        if (raw === null) continue;
        const topic = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        if (Array.isArray(topic)) {
          exprs.push(eb.or(topic.map((a) => eb(`logs.topic${idx}`, "=", a))));
        } else {
          exprs.push(eb(`logs.topic${idx}`, "=", topic));
        }
      }
    }

    if (factory.startBlock !== undefined && factory.startBlock !== 0)
      exprs.push(
        eb("logs.blockNumber", ">=", encodeAsText(factory.startBlock)),
      );
    if (factory.endBlock)
      exprs.push(eb("logs.blockNumber", "<=", encodeAsText(factory.endBlock)));

    return exprs;
  };
}

function buildFactoryChildAddressSelectExpression({
  childAddressLocation,
}: {
  childAddressLocation: FactoryCriteria["childAddressLocation"];
}) {
  if (childAddressLocation.startsWith("offset")) {
    const childAddressOffset = Number(childAddressLocation.substring(6));
    const start = 2 + 12 * 2 + childAddressOffset * 2 + 1;
    const length = 20 * 2;
    return sql<Hex>`'0x' || substring(data, ${start}, ${length})`;
  } else {
    const start = 2 + 12 * 2 + 1;
    const length = 20 * 2;
    return sql<Hex>`'0x' || substring(${sql.ref(
      childAddressLocation,
    )}, ${start}, ${length})`;
  }
}
