import {
  CompiledQuery,
  Kysely,
  Migrator,
  NO_MIGRATIONS,
  PostgresDialect,
} from "kysely";
import pg, { type Pool } from "pg";
import {
  Address,
  Hex,
  hexToNumber,
  RpcBlock,
  RpcLog,
  RpcTransaction,
  toHex,
} from "viem";

import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";
import { NonNull } from "@/types/utils";

import type { EventStore } from "../store";
import { merge_intervals } from "../utils";
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

  constructor({ pool, schema }: { pool: Pool; schema?: string }) {
    pg.types.setTypeParser(20, BigInt);
    this.db = new Kysely<EventStoreTables>({
      dialect: new PostgresDialect({
        pool,
        onCreateConnection: schema
          ? async (connection) => {
              await connection.executeQuery(
                CompiledQuery.raw(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
              );
              await connection.executeQuery(
                CompiledQuery.raw(`SET search_path = ${schema}`)
              );
            }
          : undefined,
      }),
    });

    this.migrator = new Migrator({
      db: this.db,
      provider: migrationProvider,
      migrationTableSchema: schema,
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
      await tx.insertInto("blocks").values(block).execute();
      if (transactions.length > 0) {
        await tx.insertInto("transactions").values(transactions).execute();
      }
      if (logs.length > 0) {
        await tx.insertInto("logs").values(logs).execute();
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
        .where("number", ">=", toHex(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("transactions")
        .where("blockNumber", ">=", toHex(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("logs")
        .where("blockNumber", ">=", toHex(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("contractCalls")
        .where("blockNumber", ">=", toHex(fromBlockNumber))
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
        .where("number", "<=", toHex(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("transactions")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", toHex(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("logs")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", toHex(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("contractCalls")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", toHex(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
    });
  };

  getLogEvents = async ({
    fromTimestamp,
    toTimestamp,
    filters,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
    filters: {
      chainId: number;
      address?: Address | Address[];
      topics?: (Hex | Hex[] | null)[];
      fromBlock?: number;
      toBlock?: number;
    }[];
  }) => {
    let query = this.db
      .selectFrom("logs")
      .leftJoin("blocks", "blocks.hash", "logs.blockHash")
      .leftJoin("transactions", "transactions.hash", "logs.transactionHash")
      .select([
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
      .where("blocks.timestamp", ">=", fromTimestamp)
      .where("blocks.timestamp", "<=", toTimestamp)
      .orderBy("blocks.timestamp", "asc")
      .orderBy("logs.chainId", "asc")
      .orderBy("logs.logIndex", "asc");

    query = query.where(({ and, or, cmpr }) =>
      or(
        filters.map((filter) => {
          const { chainId, address, topics, fromBlock, toBlock } = filter;

          const conditions = [cmpr("logs.chainId", "=", chainId)];

          if (address) {
            const addressArray =
              typeof address === "string" ? [address] : address;
            conditions.push(cmpr("logs.address", "in", addressArray));
          }

          if (topics) {
            topics.forEach((topic, topicIndex) => {
              if (topic === null) return;
              const columnName = `logs.topic${
                topicIndex as 0 | 1 | 2 | 3
              }` as const;
              const topicArray = typeof topic === "string" ? [topic] : topic;
              conditions.push(cmpr(columnName, "in", topicArray));
            });
          }

          if (fromBlock) {
            conditions.push(cmpr("blocks.number", ">=", toHex(fromBlock)));
          }
          if (toBlock) {
            conditions.push(cmpr("blocks.number", "<=", toHex(toBlock)));
          }

          return and(conditions);
        })
      )
    );
    const results = await query.execute();

    const logEvents = results.map((result_) => {
      // Without this cast, the block_ and tx_ fields are all nullable
      // which makes this very annoying. Should probably add a runtime check
      // that those fields are indeed present before continuing here.
      const result = result_ as NonNull<(typeof results)[number]>;

      // Note that because we set the `number` type parser to use BigInt in the
      // constructor, _all_ numbers returned from the database are bigints.
      // So, we must convert the index fields back to numbers here to match the viem types.
      const event: {
        log: Log;
        block: Block;
        transaction: Transaction;
      } = {
        log: {
          address: result.log_address,
          blockHash: result.log_blockHash,
          blockNumber: BigInt(result.log_blockNumber),
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
          baseFeePerGas: BigInt(result.block_baseFeePerGas),
          difficulty: BigInt(result.block_difficulty),
          extraData: result.block_extraData,
          gasLimit: BigInt(result.block_gasLimit),
          gasUsed: BigInt(result.block_gasUsed),
          hash: result.block_hash,
          logsBloom: result.block_logsBloom,
          miner: result.block_miner,
          mixHash: result.block_mixHash,
          nonce: result.block_nonce,
          number: BigInt(result.block_number),
          parentHash: result.block_parentHash,
          receiptsRoot: result.block_receiptsRoot,
          sha3Uncles: result.block_sha3Uncles,
          size: BigInt(result.block_size),
          stateRoot: result.block_stateRoot,
          timestamp: BigInt(result.block_timestamp),
          totalDifficulty: BigInt(result.block_totalDifficulty),
          transactionsRoot: result.block_transactionsRoot,
        },
        transaction: {
          blockHash: result.tx_blockHash,
          blockNumber: BigInt(result.tx_blockNumber),
          from: result.tx_from,
          gas: BigInt(result.tx_gas),
          hash: result.tx_hash,
          input: result.tx_input,
          nonce: Number(result.tx_nonce),
          r: result.tx_r,
          s: result.tx_s,
          to: result.tx_to,
          transactionIndex: Number(result.tx_transactionIndex),
          value: BigInt(result.tx_value),
          v: BigInt(result.tx_v),
          ...(result.tx_type === "legacy"
            ? {
                type: result.tx_type,
                gasPrice: BigInt(result.tx_gasPrice),
              }
            : result.tx_type === "eip1559"
            ? {
                type: result.tx_type,
                maxFeePerGas: BigInt(result.tx_maxFeePerGas),
                maxPriorityFeePerGas: BigInt(result.tx_maxPriorityFeePerGas),
              }
            : {
                type: result.tx_type,
                gasPrice: BigInt(result.tx_gasPrice),
                accessList: JSON.parse(result.tx_accessList),
              }),
        },
      };

      return event;
    });

    return logEvents;
  };

  getLogFilterCachedRanges = async ({ filterKey }: { filterKey: string }) => {
    const results = await this.db
      .selectFrom("logFilterCachedRanges")
      .select(["filterKey", "startBlock", "endBlock", "endBlockTimestamp"])
      .where("filterKey", "=", filterKey)
      .execute();

    return results.map((range) => ({
      ...range,
      startBlock: BigInt(range.startBlock),
      endBlock: BigInt(range.endBlock),
      endBlockTimestamp: BigInt(range.endBlockTimestamp),
    }));
  };

  insertFinalizedLogs = async ({
    chainId,
    logs: rpcLogs,
  }: {
    chainId: number;
    logs: RpcLog[];
  }) => {
    const logs: InsertableLog[] = rpcLogs.map((log) => ({
      ...rpcToPostgresLog({ log }),
      chainId,
      finalized: 1,
    }));

    if (logs.length > 0) {
      await this.db.insertInto("logs").values(logs).execute();
    }
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
      startBlock: toHex(blockNumberToCacheFrom),
      endBlock: block.number,
      endBlockTimestamp: toHex(block.timestamp),
    };

    await this.db.transaction().execute(async (tx) => {
      await tx.insertInto("blocks").values(block).execute();
      if (transactions.length > 0) {
        await tx.insertInto("transactions").values(transactions).execute();
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

        const mergedIntervals = merge_intervals(
          existingRanges.map((r) => [
            hexToNumber(r.startBlock),
            hexToNumber(r.endBlock),
          ])
        );

        const mergedRanges = mergedIntervals.map((interval) => {
          const [startBlock, endBlock] = interval;
          // For each new merged range, its endBlock will be found EITHER in the newly
          // added range OR among the endBlocks of the removed ranges.
          // Find it so we can propogate the endBlockTimestamp correctly.
          const endBlockTimestamp = existingRanges.find(
            (r) => hexToNumber(r.endBlock) === endBlock
          )!.endBlockTimestamp;

          return {
            filterKey: logFilterKey,
            startBlock: toHex(startBlock),
            endBlock: toHex(endBlock),
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
            hexToNumber(range.startBlock) <= logFilterStartBlockNumber &&
            hexToNumber(range.endBlock) >= logFilterStartBlockNumber
        );

        if (!startingRange) {
          // If there is no range containing the log filter start block number, return 0. This could happen if
          // many block tasks run concurrently and the one containing the log filter start block number is late.
          return 0;
        } else {
          return hexToNumber(startingRange.endBlockTimestamp);
        }
      });

    return { startingRangeEndTimestamp };
  };
}
