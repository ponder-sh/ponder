import {
  type Factory,
  type FactoryCriteria,
  type LogFilter,
  type LogFilterCriteria,
  type Source,
  sourceIsFactory,
  sourceIsLogFilter,
} from "@/config/sources.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { Block, Log, Transaction } from "@/types/eth.js";
import type { NonNull } from "@/types/utils.js";
import {
  type Checkpoint,
  EVENT_TYPES,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
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
  checksumAddress,
  hexToNumber,
} from "viem";
import type { SyncStore } from "../store.js";
import {
  type SyncStoreTables,
  rpcToPostgresBlock,
  rpcToPostgresLog,
  rpcToPostgresTransaction,
} from "./encoding.js";

export class PostgresSyncStore implements SyncStore {
  kind = "postgres" as const;
  db: HeadlessKysely<SyncStoreTables>;

  constructor({ db }: { db: HeadlessKysely<SyncStoreTables> }) {
    this.db = db;
  }

  insertLogFilterInterval = async ({
    chainId,
    logFilter,
    block: rpcBlock,
    transactions: rpcTransactions,
    logs: rpcLogs,
    interval,
  }: {
    chainId: number;
    logFilter: LogFilterCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    return this.db.wrap({ method: "insertLogFilterInterval" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("blocks")
          .values({ ...rpcToPostgresBlock(rpcBlock), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();

        if (rpcTransactions.length > 0) {
          const transactions = rpcTransactions.map((transaction) => ({
            ...rpcToPostgresTransaction(transaction),
            chainId,
          }));
          await tx
            .insertInto("transactions")
            .values(transactions)
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();
        }

        if (rpcLogs.length > 0) {
          const logs = rpcLogs.map((rpcLog) => ({
            ...rpcToPostgresLog(rpcLog),
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
              .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
              .returningAll()
              .executeTakeFirstOrThrow();

            const existingIntervalRows = await tx
              .deleteFrom("logFilterIntervals")
              .where("logFilterId", "=", logFilterId)
              .returningAll()
              .execute();

            const mergedIntervals = intervalUnion(
              existingIntervalRows.map((i) => [
                Number(i.startBlock),
                Number(i.endBlock),
              ]),
            );

            const mergedIntervalRows = mergedIntervals.map(
              ([startBlock, endBlock]) => ({
                logFilterId,
                startBlock: BigInt(startBlock),
                endBlock: BigInt(endBlock),
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
          "logFilterFragments(fragmentId, fragmentAddress, fragmentTopic0, fragmentTopic1, fragmentTopic2, fragmentTopic3)",
          () =>
            sql`( values ${sql.join(
              fragments.map(
                (f) =>
                  sql`( ${sql.val(f.id)}, ${sql.val(f.address)}, ${sql.val(
                    f.topic0,
                  )}, ${sql.val(f.topic1)}, ${sql.val(f.topic2)}, ${sql.val(
                    f.topic3,
                  )} )`,
              ),
            )} )`,
        )
        .selectFrom("logFilterIntervals")
        .leftJoin("logFilters", "logFilterId", "logFilters.id")
        .innerJoin("logFilterFragments", (join) => {
          let baseJoin = join.on(({ or, cmpr }) =>
            or([
              cmpr("address", "is", null),
              cmpr("fragmentAddress", "=", sql.ref("address")),
            ]),
          );
          for (const idx_ of range(0, 4)) {
            baseJoin = baseJoin.on(({ or, cmpr }) => {
              const idx = idx_ as 0 | 1 | 2 | 3;
              return or([
                cmpr(`topic${idx}`, "is", null),
                cmpr(`fragmentTopic${idx}`, "=", sql.ref(`topic${idx}`)),
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
          (acc[fragmentId] ||= []).push([Number(startBlock), Number(endBlock)]);
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
            ...rpcToPostgresLog(rpcLog),
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
    upToBlockNumber,
    factory,
    pageSize = 500,
  }: {
    chainId: number;
    upToBlockNumber: bigint;
    factory: FactoryCriteria;
    pageSize?: number;
  }) {
    const { address, eventSelector, childAddressLocation } = factory;
    const selectChildAddressExpression =
      buildFactoryChildAddressSelectExpression({ childAddressLocation });

    const baseQuery = this.db
      .selectFrom("logs")
      .select([selectChildAddressExpression.as("childAddress"), "blockNumber"])
      .where("chainId", "=", chainId)
      .where("address", "=", address)
      .where("topic0", "=", eventSelector)
      .where("blockNumber", "<=", upToBlockNumber)
      .limit(pageSize);

    let cursor: bigint | undefined = undefined;

    while (true) {
      let query = baseQuery;

      if (cursor) {
        query = query.where("blockNumber", ">", cursor);
      }

      const batch = await this.db.wrap(
        { method: "getFactoryChildAddresses" },
        () => query.execute(),
      );

      const lastRow = batch[batch.length - 1];
      if (lastRow) {
        cursor = lastRow.blockNumber;
      }

      if (batch.length > 0) {
        yield batch.map((a) => a.childAddress);
      }

      if (batch.length < pageSize) break;
    }
  }

  insertFactoryLogFilterInterval = async ({
    chainId,
    factory,
    block: rpcBlock,
    transactions: rpcTransactions,
    logs: rpcLogs,
    interval,
  }: {
    chainId: number;
    factory: FactoryCriteria;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
    interval: { startBlock: bigint; endBlock: bigint };
  }) => {
    return this.db.wrap(
      { method: "insertFactoryLogFilterInterval" },
      async () => {
        await this.db.transaction().execute(async (tx) => {
          await tx
            .insertInto("blocks")
            .values({ ...rpcToPostgresBlock(rpcBlock), chainId })
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();

          if (rpcTransactions.length > 0) {
            const transactions = rpcTransactions.map((transaction) => ({
              ...rpcToPostgresTransaction(transaction),
              chainId,
            }));
            await tx
              .insertInto("transactions")
              .values(transactions)
              .onConflict((oc) => oc.column("hash").doNothing())
              .execute();
          }

          if (rpcLogs.length > 0) {
            const logs = rpcLogs.map((rpcLog) => ({
              ...rpcToPostgresLog(rpcLog),
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
        const fragments = buildFactoryFragments({
          ...factory,
          chainId,
        });

        await Promise.all(
          fragments.map(async (fragment) => {
            await this.db.transaction().execute(async (tx) => {
              const { id: factoryId } = await tx
                .insertInto("factories")
                .values(fragment)
                .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
                .returningAll()
                .executeTakeFirstOrThrow();

              const existingIntervals = await tx
                .deleteFrom("factoryLogFilterIntervals")
                .where("factoryId", "=", factoryId)
                .returningAll()
                .execute();

              const mergedIntervals = intervalUnion(
                existingIntervals.map((i) => [
                  Number(i.startBlock),
                  Number(i.endBlock),
                ]),
              );

              const mergedIntervalRows = mergedIntervals.map(
                ([startBlock, endBlock]) => ({
                  factoryId,
                  startBlock: BigInt(startBlock),
                  endBlock: BigInt(endBlock),
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
            "factoryFilterFragments(fragmentId, fragmentAddress, fragmentEventSelector, fragmentChildAddressLocation, fragmentTopic0, fragmentTopic1, fragmentTopic2, fragmentTopic3)",
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
                    )} )`,
                ),
              )} )`,
          )
          .selectFrom("factoryLogFilterIntervals")
          .leftJoin("factories", "factoryId", "factories.id")
          .innerJoin("factoryFilterFragments", (join) => {
            let baseJoin = join.on(({ and, cmpr }) =>
              and([
                cmpr("fragmentAddress", "=", sql.ref("address")),
                cmpr("fragmentEventSelector", "=", sql.ref("eventSelector")),
                cmpr(
                  "fragmentChildAddressLocation",
                  "=",
                  sql.ref("childAddressLocation"),
                ),
              ]),
            );
            for (const idx_ of range(0, 4)) {
              baseJoin = baseJoin.on(({ or, cmpr }) => {
                const idx = idx_ as 0 | 1 | 2 | 3;
                return or([
                  cmpr(`topic${idx}`, "is", null),
                  cmpr(`fragmentTopic${idx}`, "=", sql.ref(`topic${idx}`)),
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

  createCheckpoint = (log: RpcLog, block: RpcBlock, chainId: number) => {
    if (block.number === null) {
      throw new Error("Number is missing from RPC block");
    }
    if (log.transactionIndex === null) {
      throw new Error("Transaction index is missing from RPC log");
    }
    if (log.logIndex === null) {
      throw new Error("Log index is missing from RPC log");
    }
    return encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId,
      blockNumber: hexToNumber(block.number),
      transactionIndex: hexToNumber(log.transactionIndex),
      eventType: EVENT_TYPES.logs,
      eventIndex: hexToNumber(log.logIndex),
    });
  };

  insertRealtimeBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logs: rpcLogs,
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logs: RpcLog[];
  }) => {
    return this.db.wrap({ method: "insertRealtimeBlock" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("blocks")
          .values({ ...rpcToPostgresBlock(rpcBlock), chainId })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();

        if (rpcTransactions.length > 0) {
          const transactions = rpcTransactions.map((transaction) => ({
            ...rpcToPostgresTransaction(transaction),
            chainId,
          }));
          await tx
            .insertInto("transactions")
            .values(transactions)
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute();
        }

        if (rpcLogs.length > 0) {
          const logs = rpcLogs.map((rpcLog) => ({
            ...rpcToPostgresLog(rpcLog),
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
    fromBlock,
  }: {
    chainId: number;
    fromBlock: bigint;
  }) => {
    return this.db.wrap({ method: "deleteRealtimeData" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .deleteFrom("blocks")
          .where("chainId", "=", chainId)
          .where("number", ">", fromBlock)
          .execute();
        await tx
          .deleteFrom("transactions")
          .where("chainId", "=", chainId)
          .where("blockNumber", ">", fromBlock)
          .execute();
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

        // Delete all intervals with a startBlock greater than fromBlock.
        // Then, if any intervals have an endBlock greater than fromBlock,
        // update their endBlock to equal fromBlock.
        await tx
          .deleteFrom("logFilterIntervals")
          .where(
            (qb) =>
              qb
                .selectFrom("logFilters")
                .select("logFilters.chainId")
                .whereRef(
                  "logFilters.id",
                  "=",
                  "logFilterIntervals.logFilterId",
                )
                .limit(1),
            "=",
            chainId,
          )
          .where("startBlock", ">", fromBlock)
          .execute();
        await tx
          .updateTable("logFilterIntervals")
          .set({ endBlock: fromBlock })
          .where(
            (qb) =>
              qb
                .selectFrom("logFilters")
                .select("logFilters.chainId")
                .whereRef(
                  "logFilters.id",
                  "=",
                  "logFilterIntervals.logFilterId",
                )
                .limit(1),
            "=",
            chainId,
          )
          .where("endBlock", ">", fromBlock)
          .execute();

        await tx
          .deleteFrom("factoryLogFilterIntervals")
          .where(
            (qb) =>
              qb
                .selectFrom("factories")
                .select("factories.chainId")
                .whereRef(
                  "factories.id",
                  "=",
                  "factoryLogFilterIntervals.factoryId",
                )
                .limit(1),
            "=",
            chainId,
          )
          .where("startBlock", ">", fromBlock)
          .execute();
        await tx
          .updateTable("factoryLogFilterIntervals")
          .set({ endBlock: fromBlock })
          .where(
            (qb) =>
              qb
                .selectFrom("factories")
                .select("factories.chainId")
                .whereRef(
                  "factories.id",
                  "=",
                  "factoryLogFilterIntervals.factoryId",
                )
                .limit(1),
            "=",
            chainId,
          )
          .where("endBlock", ">", fromBlock)
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
          .onConflict((oc) => oc.column("id").doUpdateSet(logFilterFragment))
          .returningAll()
          .executeTakeFirstOrThrow();

        await tx
          .insertInto("logFilterIntervals")
          .values({ logFilterId, startBlock, endBlock })
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
          .onConflict((oc) => oc.column("id").doUpdateSet(fragment))
          .returningAll()
          .executeTakeFirstOrThrow();

        await tx
          .insertInto("factoryLogFilterIntervals")
          .values({ factoryId, startBlock, endBlock })
          .execute();
      }),
    );
  };

  insertRpcRequestResult = async ({
    request,
    blockNumber,
    chainId,
    result,
  }: {
    request: string;
    blockNumber: bigint;
    chainId: number;
    result: string;
  }) => {
    return this.db.wrap({ method: "insertRpcRequestResult" }, async () => {
      await this.db
        .insertInto("rpcRequestResults")
        .values({ request, blockNumber, chainId, result })
        .onConflict((oc) =>
          oc.constraint("rpcRequestResultPrimaryKey").doUpdateSet({ result }),
        )
        .execute();
    });
  };

  getRpcRequestResult = async ({
    request,
    blockNumber,
    chainId,
  }: {
    request: string;
    blockNumber: bigint;
    chainId: number;
  }) => {
    return this.db.wrap({ method: "getRpcRequestResult" }, async () => {
      const contractReadResult = await this.db
        .selectFrom("rpcRequestResults")
        .selectAll()
        .where("request", "=", request)
        .where("blockNumber", "=", blockNumber)
        .where("chainId", "=", chainId)
        .executeTakeFirst();

      return contractReadResult ?? null;
    });
  };

  async *getLogEvents({
    sources,
    fromCheckpoint,
    toCheckpoint,
    limit,
  }: {
    sources: Pick<
      Source,
      "id" | "startBlock" | "endBlock" | "criteria" | "type"
    >[];
    fromCheckpoint: Checkpoint;
    toCheckpoint: Checkpoint;
    limit: number;
  }) {
    let cursor = encodeCheckpoint(fromCheckpoint);
    const encodedToCheckpoint = encodeCheckpoint(toCheckpoint);

    while (true) {
      const events = await this.db.wrap(
        { method: "getLogEvents" },
        async () => {
          // Get full log objects, including the eventSelector clause.
          const requestedLogs = await this.db
            .with(
              "sources(source_id)",
              () =>
                sql`( values ${sql.join(
                  sources.map((source) => sql`( ${sql.val(source.id)} )`),
                )} )`,
            )
            .selectFrom("logs")
            .leftJoin("blocks", "blocks.hash", "logs.blockHash")
            .leftJoin(
              "transactions",
              "transactions.hash",
              "logs.transactionHash",
            )
            .innerJoin("sources", (join) => join.onTrue())
            .where((eb) => {
              const logFilterCmprs = sources
                .filter(sourceIsLogFilter)
                .filter((source) => source.criteria.topics !== undefined)
                .map((logFilter) => {
                  const exprs = this.buildLogFilterCmprs({ eb, logFilter });
                  exprs.push(eb("source_id", "=", logFilter.id));
                  return eb.and(exprs);
                });

              const factoryCmprs = sources
                .filter(sourceIsFactory)
                .filter((source) => source.criteria.topics !== undefined)
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
              sourceId: row.source_id,
              chainId: row.log_chainId,
              encodedCheckpoint: row.log_checkpoint,
              log: {
                address: checksumAddress(row.log_address),
                blockHash: row.log_blockHash,
                blockNumber: row.log_blockNumber,
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
                baseFeePerGas: row.block_baseFeePerGas,
                difficulty: row.block_difficulty,
                extraData: row.block_extraData,
                gasLimit: row.block_gasLimit,
                gasUsed: row.block_gasUsed,
                hash: row.block_hash,
                logsBloom: row.block_logsBloom,
                miner: checksumAddress(row.block_miner),
                mixHash: row.block_mixHash,
                nonce: row.block_nonce,
                number: row.block_number,
                parentHash: row.block_parentHash,
                receiptsRoot: row.block_receiptsRoot,
                sha3Uncles: row.block_sha3Uncles,
                size: row.block_size,
                stateRoot: row.block_stateRoot,
                timestamp: row.block_timestamp,
                totalDifficulty: row.block_totalDifficulty,
                transactionsRoot: row.block_transactionsRoot,
              },
              transaction: {
                blockHash: row.tx_blockHash,
                blockNumber: row.tx_blockNumber,
                from: checksumAddress(row.tx_from),
                gas: row.tx_gas,
                hash: row.tx_hash,
                input: row.tx_input,
                nonce: Number(row.tx_nonce),
                r: row.tx_r,
                s: row.tx_s,
                to: row.tx_to ? checksumAddress(row.tx_to) : row.tx_to,
                transactionIndex: Number(row.tx_transactionIndex),
                value: row.tx_value,
                v: row.tx_v,
                ...(row.tx_type === "0x0"
                  ? { type: "legacy", gasPrice: row.tx_gasPrice }
                  : row.tx_type === "0x1"
                    ? {
                        type: "eip2930",
                        gasPrice: row.tx_gasPrice,
                        accessList: JSON.parse(row.tx_accessList),
                      }
                    : row.tx_type === "0x2"
                      ? {
                          type: "eip1559",
                          maxFeePerGas: row.tx_maxFeePerGas,
                          maxPriorityFeePerGas: row.tx_maxPriorityFeePerGas,
                        }
                      : row.tx_type === "0x7e"
                        ? {
                            type: "deposit",
                            maxFeePerGas: row.tx_maxFeePerGas ?? undefined,
                            maxPriorityFeePerGas:
                              row.tx_maxPriorityFeePerGas ?? undefined,
                          }
                        : { type: row.tx_type }),
              },
            } satisfies {
              chainId: number;
              sourceId: string;
              log: Log;
              block: Block;
              transaction: Transaction;
              encodedCheckpoint: string;
            };
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
      Source,
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
            .filter(sourceIsLogFilter)
            .filter((source) => source.criteria.topics !== undefined)
            .map((logFilter) => {
              const exprs = this.buildLogFilterCmprs({ eb, logFilter });
              return eb.and(exprs);
            });

          const factoryCmprs = sources
            .filter(sourceIsFactory)
            .filter((source) => source.criteria.topics !== undefined)
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
    logFilter: LogFilter;
  }) => {
    const exprs = [];

    exprs.push(
      eb(
        "logs.chainId",
        "=",
        sql`cast (${sql.val(logFilter.chainId)} as numeric(16, 0))`,
      ),
    );

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
      exprs.push(eb("logs.blockNumber", ">=", BigInt(logFilter.startBlock)));
    if (logFilter.endBlock)
      exprs.push(eb("logs.blockNumber", "<=", BigInt(logFilter.endBlock)));

    return exprs;
  };

  private buildFactoryCmprs = ({
    eb,
    factory,
  }: {
    eb: ExpressionBuilder<any, any>;
    factory: Factory;
  }) => {
    const exprs = [];

    exprs.push(
      eb(
        "logs.chainId",
        "=",
        sql`cast (${sql.val(factory.chainId)} as numeric(16, 0))`,
      ),
    );

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
      exprs.push(eb("logs.blockNumber", ">=", BigInt(factory.startBlock)));
    if (factory.endBlock)
      exprs.push(eb("logs.blockNumber", "<=", BigInt(factory.endBlock)));

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
    return sql<Hex>`'0x' || substring(data from ${start}::int for ${length}::int)`;
  } else {
    const start = 2 + 12 * 2 + 1;
    const length = 20 * 2;
    return sql<Hex>`'0x' || substring(${sql.ref(
      childAddressLocation,
    )} from ${start}::integer for ${length}::integer)`;
  }
}
