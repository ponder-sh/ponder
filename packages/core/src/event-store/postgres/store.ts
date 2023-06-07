import {
  CompiledQuery,
  Kysely,
  Migrator,
  NO_MIGRATIONS,
  PostgresDialect,
  sql,
} from "kysely";
import type { Pool } from "pg";
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
  rpcToPostgresBlock,
  rpcToPostgresLog,
  rpcToPostgresTransaction,
} from "./format";
import { migrationProvider } from "./migrations";

export class PostgresEventStore implements EventStore {
  db: Kysely<EventStoreTables>;
  private migrator: Migrator;

  constructor({
    pool,
    databaseSchema,
  }: {
    pool: Pool;
    databaseSchema?: string;
  }) {
    this.db = new Kysely<EventStoreTables>({
      dialect: new PostgresDialect({
        pool,
        onCreateConnection: databaseSchema
          ? async (connection) => {
              await connection.executeQuery(
                CompiledQuery.raw(
                  `CREATE SCHEMA IF NOT EXISTS ${databaseSchema}`
                )
              );
              await connection.executeQuery(
                CompiledQuery.raw(`SET search_path = ${databaseSchema}`)
              );
            }
          : undefined,
      }),
    });

    this.migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableSchema: databaseSchema ?? "public",
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
      ...rpcToPostgresBlock(rpcBlock),
      chainId,
      finalized: 0,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...rpcToPostgresTransaction(transaction),
        chainId,
        finalized: 0,
      })
    );

    const logs: InsertableLog[] = rpcLogs.map((log) => ({
      ...rpcToPostgresLog({ log }),
      chainId,
      finalized: 0,
    }));

    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("blocks")
        .values(block)
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();
      if (transactions.length > 0) {
        await tx
          .insertInto("transactions")
          .values(transactions)
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }
      if (logs.length > 0) {
        await tx
          .insertInto("logs")
          .values(logs)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      }
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

  insertFinalizedLogs = async ({
    chainId,
    logs: rpcLogs,
  }: {
    chainId: number;
    logs: RpcLog[];
  }) => {
    const logBatches = rpcLogs.reduce<InsertableLog[][]>((acc, log, index) => {
      const batchIndex = Math.floor(index / 1000);
      acc[batchIndex] = acc[batchIndex] ?? [];
      acc[batchIndex].push({
        ...rpcToPostgresLog({ log }),
        chainId,
        finalized: 1,
      });
      return acc;
    }, []);

    await Promise.all(
      logBatches.map(async (batch) => {
        await this.db
          .insertInto("logs")
          .values(batch)
          .onConflict((oc) => oc.column("id").doNothing())
          .execute();
      })
    );
  };

  insertFinalizedBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logFilterRange: {
      logFilterKey,
      blockNumberToCacheFrom,
      logFilterStartBlockNumber,
    },
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logFilterRange: {
      logFilterKey: string;
      blockNumberToCacheFrom: number;
      logFilterStartBlockNumber: number;
    };
  }) => {
    const block: InsertableBlock = {
      ...rpcToPostgresBlock(rpcBlock),
      chainId,
      finalized: 1,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...rpcToPostgresTransaction(transaction),
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
      await tx
        .insertInto("blocks")
        .values(block)
        .onConflict((oc) => oc.column("hash").doNothing())
        .execute();
      if (transactions.length > 0) {
        await tx
          .insertInto("transactions")
          .values(transactions)
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute();
      }
      await tx
        .insertInto("logFilterCachedRanges")
        .values(logFilterCachedRange)
        .execute();
    });

    // After inserting the new cached range record, execute a transaction to merge
    // all adjacent cached ranges. Return the end block timestamp of the cached interval
    // that contains the start block number of the log filter.
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

        if (mergedRanges.length > 0) {
          await tx
            .insertInto("logFilterCachedRanges")
            .values(mergedRanges)
            .execute();
        }

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
      .onConflict((oc) =>
        oc.constraint("contractReadResultPrimaryKey").doUpdateSet({ result })
      )
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

  getLogEvents = async ({
    fromTimestamp,
    toTimestamp,
    filters = [],
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
      handledTopic0?: Hex[];
    }[];
  }) => {
    const handledLogQuery = this.db
      .with(
        "logFilters(logFilter_name, logFilter_chainId, logFilter_address, logFilter_topic0, logFilter_topic1, logFilter_topic2, logFilter_topic3, logFilter_fromBlock, logFilter_toBlock, logFilter_handledTopic0)",
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
        // "logs.chainId as log_chainId",
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
            cmpr("logFilter_handledTopic0", "is", null),
            cmpr(
              "logFilter_handledTopic0",
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
      .orderBy("logs.logIndex", "asc")
      .orderBy("logFilter_name", "asc");

    // Get total count of matching logs.
    const totalLogCountQuery = this.db
      .with(
        "logFilters(logFilter_name, logFilter_chainId, logFilter_address, logFilter_topic0, logFilter_topic1, logFilter_topic2, logFilter_topic3, logFilter_fromBlock, logFilter_toBlock, logFilter_handledTopic0)",
        () => sql`( values ${sql.join(filters.map(buildLogFilterValues))} )`
      )
      .selectFrom("logs")
      .leftJoin("blocks", "blocks.hash", "logs.blockHash")
      .innerJoin("logFilters", (join) => join.onTrue())
      .select(this.db.fn.count("logs.id").as("log_count"))
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
      .where("blocks.timestamp", "<=", intToBlob(toTimestamp));

    // Get handled logs.
    const handledLogs = await handledLogQuery.execute();

    const totalLogCount = await totalLogCountQuery.execute();
    const totalEventCount = totalLogCount[0].log_count as number;

    const events = handledLogs.map((result_) => {
      // Without this cast, the block_ and tx_ fields are all nullable
      // which makes this very annoying. Should probably add a runtime check
      // that those fields are indeed present before continuing here.
      const result = result_ as NonNull<(typeof handledLogs)[number]>;

      const event: {
        filterName: string;
        log: Log;
        block: Block;
        transaction: Transaction;
      } = {
        filterName: result.logFilter_name,
        log: {
          address: result.log_address,
          blockHash: result.log_blockHash,
          blockNumber: blobToBigInt(result.log_blockNumber),
          data: result.log_data,
          id: result.log_id,
          logIndex: Number(result.log_logIndex),
          removed: false,
          topics: [
            result.log_topic0,
            result.log_topic1,
            result.log_topic2,
            result.log_topic3,
          ].filter((t): t is Hex => t !== null) as [Hex, ...Hex[]] | [],
          transactionHash: result.log_transactionHash,
          transactionIndex: Number(result.log_transactionIndex),
        },
        block: {
          baseFeePerGas: blobToBigInt(result.block_baseFeePerGas),
          difficulty: blobToBigInt(result.block_difficulty),
          extraData: result.block_extraData,
          gasLimit: blobToBigInt(result.block_gasLimit),
          gasUsed: blobToBigInt(result.block_gasUsed),
          hash: result.block_hash,
          logsBloom: result.block_logsBloom,
          miner: result.block_miner,
          mixHash: result.block_mixHash,
          nonce: result.block_nonce,
          number: blobToBigInt(result.block_number),
          parentHash: result.block_parentHash,
          receiptsRoot: result.block_receiptsRoot,
          sha3Uncles: result.block_sha3Uncles,
          size: blobToBigInt(result.block_size),
          stateRoot: result.block_stateRoot,
          timestamp: blobToBigInt(result.block_timestamp),
          totalDifficulty: blobToBigInt(result.block_totalDifficulty),
          transactionsRoot: result.block_transactionsRoot,
        },
        transaction: {
          blockHash: result.tx_blockHash,
          blockNumber: blobToBigInt(result.tx_blockNumber),
          from: result.tx_from,
          gas: blobToBigInt(result.tx_gas),
          hash: result.tx_hash,
          input: result.tx_input,
          nonce: Number(result.tx_nonce),
          r: result.tx_r,
          s: result.tx_s,
          to: result.tx_to,
          transactionIndex: Number(result.tx_transactionIndex),
          value: blobToBigInt(result.tx_value),
          v: blobToBigInt(result.tx_v),
          ...(result.tx_type === "legacy"
            ? {
                type: result.tx_type,
                gasPrice: blobToBigInt(result.tx_gasPrice),
              }
            : result.tx_type === "eip1559"
            ? {
                type: result.tx_type,
                maxFeePerGas: blobToBigInt(result.tx_maxFeePerGas),
                maxPriorityFeePerGas: blobToBigInt(
                  result.tx_maxPriorityFeePerGas
                ),
              }
            : {
                type: result.tx_type,
                gasPrice: blobToBigInt(result.tx_gasPrice),
                accessList: JSON.parse(result.tx_accessList),
              }),
        },
      };

      return event;
    });

    return {
      events,
      totalEventCount,
    };
  };
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

export function buildLogFilterValues(filter: {
  name: string;
  chainId: number;
  address?: Address | Address[];
  topics?: (Hex | Hex[] | null)[];
  fromBlock?: number;
  toBlock?: number;
  handledTopic0?: Hex[];
}) {
  const { name, chainId, address, topics, fromBlock, toBlock, handledTopic0 } =
    filter;

  const address_ = getLogFilterAddressOrTopic(address);
  const [topic0, topic1, topic2, topic3] = getLogFilterTopics(topics);
  const handledTopic0_ = getLogFilterAddressOrTopic(handledTopic0);

  return sql`(${sql.join([
    sql.val(name),
    sql`${sql.val(chainId)}::integer`,
    sql.val(address_),
    sql.val(topic0),
    sql.val(topic1),
    sql.val(topic2),
    sql.val(topic3),
    sql`${sql.val(fromBlock ? intToBlob(fromBlock) : null)}::bytea`,
    sql`${sql.val(toBlock ? intToBlob(toBlock) : null)}::bytea`,
    sql.val(handledTopic0_),
  ])})`;
}
