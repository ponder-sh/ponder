import type Sqlite from "better-sqlite3";
import { Kysely, Migrator, NO_MIGRATIONS, sql, SqliteDialect } from "kysely";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";
import type { NonNull } from "@/types/utils";
import { blobToBigInt } from "@/utils/decode";
import { intToBlob } from "@/utils/encode";
import { mergeIntervals } from "@/utils/intervals";

import type { EventStore } from "../store";
import {
  type EventStoreTables,
  type InsertableBlock,
  type InsertableLog,
  type InsertableTransaction,
  rpcToSqliteBlock,
  rpcToSqliteLog,
  rpcToSqliteTransaction,
} from "./format";
import { migrationProvider } from "./migrations";

export class SqliteEventStore implements EventStore {
  db: Kysely<EventStoreTables>;
  migrator: Migrator;

  constructor({ db }: { db: Sqlite.Database }) {
    this.db = new Kysely<EventStoreTables>({
      dialect: new SqliteDialect({ database: db }),
    });

    this.migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
    });
  }

  migrateUp = async () => {
    const { error } = await this.migrator.migrateToLatest();
    if (error) throw error;
  };

  migrateDown = async () => {
    const { error } = await this.migrator.migrateTo(NO_MIGRATIONS);
    if (error) throw error;
  };

  insertUnfinalizedBlock = async ({
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
    const block: InsertableBlock = {
      ...rpcToSqliteBlock(rpcBlock),
      chainId,
      finalized: 0,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...rpcToSqliteTransaction(transaction),
        chainId,
        finalized: 0,
      })
    );

    const logs: InsertableLog[] = rpcLogs.map((log) => ({
      ...rpcToSqliteLog({ log }),
      chainId,
      finalized: 0,
    }));

    await this.db.transaction().execute(async (tx) => {
      await Promise.all([
        tx
          .insertInto("blocks")
          .values(block)
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute(),
        ...transactions.map((transaction) =>
          tx
            .insertInto("transactions")
            .values(transaction)
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute()
        ),
        ...logs.map((log) =>
          tx
            .insertInto("logs")
            .values(log)
            .onConflict((oc) => oc.column("id").doNothing())
            .execute()
        ),
      ]);
    });
  };

  deleteUnfinalizedData = async ({
    chainId,
    fromBlockNumber,
  }: {
    chainId: number;
    fromBlockNumber: number;
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom("blocks")
        .where("number", ">=", intToBlob(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("transactions")
        .where("blockNumber", ">=", intToBlob(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("logs")
        .where("blockNumber", ">=", intToBlob(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("contractReadResults")
        .where("blockNumber", ">=", intToBlob(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
    });
  };

  finalizeData = async ({
    chainId,
    toBlockNumber,
  }: {
    chainId: number;
    toBlockNumber: number;
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("blocks")
        .set({ finalized: 1 })
        .where("number", "<=", intToBlob(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("transactions")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", intToBlob(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("logs")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", intToBlob(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("contractReadResults")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", intToBlob(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
    });
  };

  insertFinalizedLogs = async ({
    chainId,
    logs: rpcLogs,
  }: {
    chainId: number;
    logs: RpcLog[];
  }) => {
    const logs: InsertableLog[] = rpcLogs.map((log) => ({
      ...rpcToSqliteLog({ log }),
      chainId,
      finalized: 1,
    }));

    await Promise.all(
      logs.map((log) =>
        this.db
          .insertInto("logs")
          .values(log)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute()
      )
    );
  };

  insertFinalizedBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logFilterRange: { logFilterKey, blockNumberToCacheFrom },
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logFilterRange: { logFilterKey: string; blockNumberToCacheFrom: number };
  }) => {
    const block: InsertableBlock = {
      ...rpcToSqliteBlock(rpcBlock),
      chainId,
      finalized: 1,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...rpcToSqliteTransaction(transaction),
        chainId,
        finalized: 1,
      })
    );

    const logFilterCachedRange = {
      filterKey: logFilterKey,
      startBlock: intToBlob(blockNumberToCacheFrom),
      endBlock: block.number,
      endBlockTimestamp: block.timestamp,
    };

    await this.db.transaction().execute(async (tx) => {
      await Promise.all([
        tx
          .insertInto("blocks")
          .values(block)
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute(),
        ...transactions.map((transaction) =>
          tx
            .insertInto("transactions")
            .values(transaction)
            .onConflict((oc) => oc.column("hash").doNothing())
            .execute()
        ),
        tx
          .insertInto("logFilterCachedRanges")
          .values(logFilterCachedRange)
          .execute(),
      ]);
    });
  };

  mergeLogFilterCachedRanges = async ({
    logFilterKey,
    logFilterStartBlockNumber,
  }: {
    logFilterKey: string;
    logFilterStartBlockNumber: number;
  }) => {
    const startingRangeEndTimestamp = await this.db
      .transaction()
      .execute(async (tx) => {
        const existingRanges = await tx
          .deleteFrom("logFilterCachedRanges")
          .where("filterKey", "=", logFilterKey)
          .returningAll()
          .execute();

        const mergedIntervals = mergeIntervals(
          existingRanges.map((r) => [
            Number(blobToBigInt(r.startBlock)),
            Number(blobToBigInt(r.endBlock)),
          ])
        );

        const mergedRanges = mergedIntervals.map((interval) => {
          const [startBlock, endBlock] = interval;
          // For each new merged range, its endBlock will be found EITHER in the newly
          // added range OR among the endBlocks of the removed ranges.
          // Find it so we can propogate the endBlockTimestamp correctly.
          const endBlockTimestamp = existingRanges.find(
            (r) => Number(blobToBigInt(r.endBlock)) === endBlock
          )!.endBlockTimestamp;

          return {
            filterKey: logFilterKey,
            startBlock: intToBlob(startBlock),
            endBlock: intToBlob(endBlock),
            endBlockTimestamp: endBlockTimestamp,
          };
        });

        await Promise.all(
          mergedRanges.map((range) =>
            tx.insertInto("logFilterCachedRanges").values(range).execute()
          )
        );

        // After we've inserted the new ranges, find the range that contains the log filter start block number.
        // We need this to determine the new latest available event timestamp for the log filter.
        const startingRange = mergedRanges.find(
          (range) =>
            Number(blobToBigInt(range.startBlock)) <=
              logFilterStartBlockNumber &&
            Number(blobToBigInt(range.endBlock)) >= logFilterStartBlockNumber
        );

        if (!startingRange) {
          // If there is no range containing the log filter start block number, return 0. This could happen if
          // many block tasks run concurrently and the one containing the log filter start block number is late.
          return 0;
        } else {
          return Number(blobToBigInt(startingRange.endBlockTimestamp));
        }
      });

    return { startingRangeEndTimestamp };
  };

  getLogFilterCachedRanges = async ({ filterKey }: { filterKey: string }) => {
    const results = await this.db
      .selectFrom("logFilterCachedRanges")
      .select(["filterKey", "startBlock", "endBlock", "endBlockTimestamp"])
      .where("filterKey", "=", filterKey)
      .execute();

    return results.map((range) => ({
      ...range,
      startBlock: blobToBigInt(range.startBlock),
      endBlock: blobToBigInt(range.endBlock),
      endBlockTimestamp: blobToBigInt(range.endBlockTimestamp),
    }));
  };

  insertContractReadResult = async ({
    address,
    blockNumber,
    chainId,
    data,
    finalized,
    result,
  }: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
    finalized: boolean;
    result: Hex;
  }) => {
    await this.db
      .insertInto("contractReadResults")
      .values({
        address,
        blockNumber: intToBlob(blockNumber),
        chainId,
        data,
        finalized: finalized ? 1 : 0,
        result,
      })
      .onConflict((oc) => oc.doUpdateSet({ result }))
      .execute();
  };

  getContractReadResult = async ({
    address,
    blockNumber,
    chainId,
    data,
  }: {
    address: string;
    blockNumber: bigint;
    chainId: number;
    data: Hex;
  }) => {
    const contractReadResult = await this.db
      .selectFrom("contractReadResults")
      .selectAll()
      .where("address", "=", address)
      .where("blockNumber", "=", intToBlob(blockNumber))
      .where("chainId", "=", chainId)
      .where("data", "=", data)
      .executeTakeFirst();

    return contractReadResult
      ? {
          ...contractReadResult,
          blockNumber: blobToBigInt(contractReadResult.blockNumber),
          finalized: contractReadResult.finalized === 1,
        }
      : null;
  };

  async *getLogEvents({
    fromTimestamp,
    toTimestamp,
    filters = [],
    pageSize = 10_000,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
    filters?: {
      name: string;
      chainId: number;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
      fromBlock?: number;
      toBlock?: number;
      includeEventSelectors?: Hex[];
    }[];
    pageSize: number;
  }) {
    const includedLogQueryBase = this.db
      .with(
        "logFilters(logFilter_name, logFilter_chainId, logFilter_address, logFilter_topic0, logFilter_topic1, logFilter_topic2, logFilter_topic3, logFilter_fromBlock, logFilter_toBlock, logFilter_includeEventSelectors)",
        () => sql`( values ${sql.join(filters.map(buildLogFilterValues))} )`
      )
      .selectFrom("logs")
      .leftJoin("blocks", "blocks.hash", "logs.blockHash")
      .leftJoin("transactions", "transactions.hash", "logs.transactionHash")
      .innerJoin("logFilters", (join) => join.onTrue())
      .select([
        "logFilter_name",

        "logs.address as log_address",
        "logs.blockHash as log_blockHash",
        "logs.blockNumber as log_blockNumber",
        "logs.chainId as log_chainId",
        "logs.data as log_data",
        // "logs.finalized as log_finalized",
        "logs.id as log_id",
        "logs.logIndex as log_logIndex",
        "logs.topic0 as log_topic0",
        "logs.topic1 as log_topic1",
        "logs.topic2 as log_topic2",
        "logs.topic3 as log_topic3",
        "logs.transactionHash as log_transactionHash",
        "logs.transactionIndex as log_transactionIndex",

        "blocks.baseFeePerGas as block_baseFeePerGas",
        // "blocks.chainId as block_chainId",
        "blocks.difficulty as block_difficulty",
        "blocks.extraData as block_extraData",
        // "blocks.finalized as block_finalized",
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
        // "transactions.chainId as tx_chainId",
        // "transactions.finalized as tx_finalized",
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
      .where(({ and, or, cmpr, ref }) =>
        and([
          cmpr("logs.chainId", "=", ref("logFilter_chainId")),
          or([
            cmpr("logFilter_address", "is", null),
            cmpr("logFilter_address", "like", sql`'%' || logs.address || '%'`),
          ]),
          and([
            or([
              cmpr("logFilter_topic0", "is", null),
              cmpr("logFilter_topic0", "like", sql`'%' || logs.topic0 || '%'`),
            ]),
            or([
              cmpr("logFilter_topic1", "is", null),
              cmpr("logFilter_topic1", "like", sql`'%' || logs.topic1 || '%'`),
            ]),
            or([
              cmpr("logFilter_topic2", "is", null),
              cmpr("logFilter_topic2", "like", sql`'%' || logs.topic2 || '%'`),
            ]),
            or([
              cmpr("logFilter_topic3", "is", null),
              cmpr("logFilter_topic3", "like", sql`'%' || logs.topic3 || '%'`),
            ]),
          ]),
          or([
            cmpr("logFilter_fromBlock", "is", null),
            cmpr("blocks.number", ">=", ref("logFilter_fromBlock")),
          ]),
          or([
            cmpr("logFilter_toBlock", "is", null),
            cmpr("blocks.number", "<=", ref("logFilter_toBlock")),
          ]),
          or([
            cmpr("logFilter_includeEventSelectors", "is", null),
            cmpr(
              "logFilter_includeEventSelectors",
              "like",
              sql`'%' || logs.topic0 || '%'`
            ),
          ]),
        ])
      )
      .where("blocks.timestamp", ">=", intToBlob(fromTimestamp))
      .where("blocks.timestamp", "<=", intToBlob(toTimestamp))
      .orderBy("blocks.timestamp", "asc")
      .orderBy("logs.chainId", "asc")
      .orderBy("blocks.number", "asc")
      .orderBy("logs.logIndex", "asc");

    // Get total count of matching logs, grouped by log filter and event selector.
    const eventCountsQuery = this.db
      .with(
        "logFilters(logFilter_name, logFilter_chainId, logFilter_address, logFilter_topic0, logFilter_topic1, logFilter_topic2, logFilter_topic3, logFilter_fromBlock, logFilter_toBlock, logFilter_includeEventSelectors)",
        () => sql`( values ${sql.join(filters.map(buildLogFilterValues))} )`
      )
      .selectFrom("logs")
      .leftJoin("blocks", "blocks.hash", "logs.blockHash")
      .innerJoin("logFilters", (join) => join.onTrue())
      .select([
        "logFilter_name",
        "logs.topic0",
        this.db.fn.count("logs.id").as("count"),
      ])
      .where(({ and, or, cmpr, ref }) =>
        and([
          cmpr("logs.chainId", "=", ref("logFilter_chainId")),
          or([
            cmpr("logFilter_address", "is", null),
            cmpr("logFilter_address", "like", sql`'%' || logs.address || '%'`),
          ]),
          and([
            or([
              cmpr("logFilter_topic0", "is", null),
              cmpr("logFilter_topic0", "like", sql`'%' || logs.topic0 || '%'`),
            ]),
            or([
              cmpr("logFilter_topic1", "is", null),
              cmpr("logFilter_topic1", "like", sql`'%' || logs.topic1 || '%'`),
            ]),
            or([
              cmpr("logFilter_topic2", "is", null),
              cmpr("logFilter_topic2", "like", sql`'%' || logs.topic2 || '%'`),
            ]),
            or([
              cmpr("logFilter_topic3", "is", null),
              cmpr("logFilter_topic3", "like", sql`'%' || logs.topic3 || '%'`),
            ]),
          ]),
          or([
            cmpr("logFilter_fromBlock", "is", null),
            cmpr("blocks.number", ">=", ref("logFilter_fromBlock")),
          ]),
          or([
            cmpr("logFilter_toBlock", "is", null),
            cmpr("blocks.number", "<=", ref("logFilter_toBlock")),
          ]),
        ])
      )
      .where("blocks.timestamp", ">=", intToBlob(fromTimestamp))
      .where("blocks.timestamp", "<=", intToBlob(toTimestamp))
      .groupBy(["logFilter_name", "logs.topic0"]);

    // Fetch the event counts once and include it in every response.
    const eventCountsRaw = await eventCountsQuery.execute();
    const eventCounts = eventCountsRaw.map((c) => ({
      logFilterName: String(c.logFilter_name),
      selector: c.topic0 as Hex,
      count: Number(c.count),
    }));

    let cursor:
      | {
          timestamp: Buffer;
          chainId: number;
          blockNumber: Buffer;
          logIndex: number;
        }
      | undefined = undefined;

    while (true) {
      let query = includedLogQueryBase.limit(pageSize);
      if (cursor) {
        // See this comment for an explanation of the cursor logic.
        // https://stackoverflow.com/a/38017813
        // This is required to avoid skipping logs that have the same timestamp.
        query = query.where(({ and, or, cmpr }) => {
          const { timestamp, chainId, blockNumber, logIndex } = cursor!;
          return and([
            cmpr("blocks.timestamp", ">=", timestamp),
            or([
              cmpr("blocks.timestamp", ">", timestamp),
              and([
                cmpr("logs.chainId", ">=", chainId),
                or([
                  cmpr("logs.chainId", ">", chainId),
                  and([
                    cmpr("blocks.number", ">=", blockNumber),
                    or([
                      cmpr("blocks.number", ">", blockNumber),
                      cmpr("logs.logIndex", ">", logIndex),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]);
        });
      }

      const requestedLogs = await query.execute();

      const events = requestedLogs.map((_row) => {
        // Without this cast, the block_ and tx_ fields are all nullable
        // which makes this very annoying. Should probably add a runtime check
        // that those fields are indeed present before continuing here.
        const row = _row as NonNull<(typeof requestedLogs)[number]>;
        return {
          logFilterName: row.logFilter_name,
          log: {
            address: row.log_address,
            blockHash: row.log_blockHash,
            blockNumber: blobToBigInt(row.log_blockNumber),
            data: row.log_data,
            id: row.log_id,
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
              ? blobToBigInt(row.block_baseFeePerGas)
              : null,
            difficulty: blobToBigInt(row.block_difficulty),
            extraData: row.block_extraData,
            gasLimit: blobToBigInt(row.block_gasLimit),
            gasUsed: blobToBigInt(row.block_gasUsed),
            hash: row.block_hash,
            logsBloom: row.block_logsBloom,
            miner: row.block_miner,
            mixHash: row.block_mixHash,
            nonce: row.block_nonce,
            number: blobToBigInt(row.block_number),
            parentHash: row.block_parentHash,
            receiptsRoot: row.block_receiptsRoot,
            sha3Uncles: row.block_sha3Uncles,
            size: blobToBigInt(row.block_size),
            stateRoot: row.block_stateRoot,
            timestamp: blobToBigInt(row.block_timestamp),
            totalDifficulty: blobToBigInt(row.block_totalDifficulty),
            transactionsRoot: row.block_transactionsRoot,
          },
          transaction: {
            blockHash: row.tx_blockHash,
            blockNumber: blobToBigInt(row.tx_blockNumber),
            from: row.tx_from,
            gas: blobToBigInt(row.tx_gas),
            hash: row.tx_hash,
            input: row.tx_input,
            nonce: Number(row.tx_nonce),
            r: row.tx_r,
            s: row.tx_s,
            to: row.tx_to,
            transactionIndex: Number(row.tx_transactionIndex),
            value: blobToBigInt(row.tx_value),
            v: blobToBigInt(row.tx_v),
            ...(row.tx_type === "0x0"
              ? {
                  type: "legacy",
                  gasPrice: blobToBigInt(row.tx_gasPrice),
                }
              : row.tx_type === "0x1"
              ? {
                  type: "eip2930",
                  gasPrice: blobToBigInt(row.tx_gasPrice),
                  accessList: JSON.parse(row.tx_accessList),
                }
              : row.tx_type === "0x2"
              ? {
                  type: "eip1559",
                  maxFeePerGas: blobToBigInt(row.tx_maxFeePerGas),
                  maxPriorityFeePerGas: blobToBigInt(
                    row.tx_maxPriorityFeePerGas
                  ),
                }
              : row.tx_type === "0x7e"
              ? {
                  type: "deposit",
                  maxFeePerGas: blobToBigInt(row.tx_maxFeePerGas),
                  maxPriorityFeePerGas: blobToBigInt(
                    row.tx_maxPriorityFeePerGas
                  ),
                }
              : {
                  type: row.tx_type,
                }),
          },
        } satisfies {
          logFilterName: string;
          log: Log;
          block: Block;
          transaction: Transaction;
        };
      });

      const lastRow = requestedLogs[requestedLogs.length - 1];
      if (lastRow) {
        cursor = {
          timestamp: lastRow.block_timestamp!,
          chainId: lastRow.log_chainId,
          blockNumber: lastRow.block_number!,
          logIndex: lastRow.log_logIndex,
        };
      }

      const lastEventBlockTimestamp = lastRow?.block_timestamp;
      const pageEndsAtTimestamp = lastEventBlockTimestamp
        ? Number(blobToBigInt(lastEventBlockTimestamp))
        : toTimestamp;

      yield {
        events,
        metadata: {
          pageEndsAtTimestamp,
          counts: eventCounts,
        },
      };

      if (events.length < pageSize) break;
    }
  }
}

function getLogFilterAddressOrTopic(value: Hex | Hex[] | undefined | null) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return value.join(",");
}

function getLogFilterTopics(topics: (Hex | Hex[] | null)[] | undefined) {
  if (!topics) return [null, null, null, null];
  const topic0 = getLogFilterAddressOrTopic(topics[0]);
  const topic1 = getLogFilterAddressOrTopic(topics[1]);
  const topic2 = getLogFilterAddressOrTopic(topics[2]);
  const topic3 = getLogFilterAddressOrTopic(topics[3]);
  return [topic0, topic1, topic2, topic3];
}

function buildLogFilterValues(filter: {
  name: string;
  chainId: number;
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock?: number;
  toBlock?: number;
  includeEventSelectors?: Hex[];
}) {
  const {
    name,
    chainId,
    address,
    topics,
    fromBlock,
    toBlock,
    includeEventSelectors,
  } = filter;

  const address_ = getLogFilterAddressOrTopic(address);
  const [topic0, topic1, topic2, topic3] = getLogFilterTopics(topics);
  const includeEventSelectors_ = getLogFilterAddressOrTopic(
    includeEventSelectors
  );

  return sql`(${sql.join([
    sql.val(name),
    sql`cast (${sql.val(chainId)} as integer)`,
    sql.val(address_),
    sql.val(topic0),
    sql.val(topic1),
    sql.val(topic2),
    sql.val(topic3),
    sql`cast (${sql.val(fromBlock ? intToBlob(fromBlock) : null)} as blob)`,
    sql`cast (${sql.val(toBlock ? intToBlob(toBlock) : null)} as blob)`,
    sql.val(includeEventSelectors_),
  ])})`;
}
