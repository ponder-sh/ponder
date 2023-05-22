import {
  CompiledQuery,
  Kysely,
  Migrator,
  NO_MIGRATIONS,
  PostgresDialect,
} from "kysely";
import pg, { type Pool } from "pg";
import type { Address, Hex, RpcBlock, RpcLog, RpcTransaction } from "viem";

import { NonNull } from "@/types/utils";

import {
  formatRpcBlock,
  formatRpcLog,
  formatRpcTransaction,
} from "../formatters";
import type { EventStore } from "../store";
import type {
  Block,
  EventStoreTables,
  InsertableBlock,
  InsertableLog,
  InsertableTransaction,
  Log,
  Transaction,
} from "../types";
import { merge_intervals } from "../utils";
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
    const block = formatRpcBlock({ block: rpcBlock }) as InsertableBlock;
    block.chainId = chainId;
    block.finalized = 0;

    const transactions = rpcTransactions.map((t) => {
      const transaction = formatRpcTransaction({
        transaction: t,
      }) as InsertableTransaction;
      transaction.chainId = chainId;
      transaction.finalized = 0;
      return transaction;
    });

    const logs = rpcLogs.map((l) => {
      const log = formatRpcLog({
        log: l,
      }) as InsertableLog;
      log.chainId = chainId;
      log.finalized = 0;
      return log;
    });

    await this.db.transaction().execute(async (tx) => {
      await tx.insertInto("blocks").values(block).execute();
      await Promise.all([
        ...transactions.map(async (transaction) =>
          tx.insertInto("transactions").values(transaction).execute()
        ),
        ...logs.map(async (log) => tx.insertInto("logs").values(log).execute()),
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
        .where("number", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("transactions")
        .where("blockNumber", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("logs")
        .where("blockNumber", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .deleteFrom("contractCalls")
        .where("blockNumber", ">=", BigInt(fromBlockNumber))
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
        .where("number", "<=", BigInt(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("transactions")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", BigInt(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("logs")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", BigInt(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
      await tx
        .updateTable("contractCalls")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", BigInt(toBlockNumber))
        .where("chainId", "=", chainId)
        .execute();
    });
  };

  getLogEvents = async ({
    chainId,
    fromTimestamp,
    toTimestamp,
    address,
    topics,
  }: {
    chainId: number;
    fromTimestamp: number;
    toTimestamp: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
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
      .where("logs.chainId", "=", chainId)
      .where("blocks.timestamp", ">=", BigInt(fromTimestamp))
      .where("blocks.timestamp", "<=", BigInt(toTimestamp));

    if (address) {
      const addressArray = typeof address === "string" ? [address] : address;
      query = query.where("logs.address", "in", addressArray);
    }

    if (topics) {
      topics.forEach((topic, topicIndex) => {
        if (topic === null) return;
        const columnName = `logs.topic${topicIndex as 0 | 1 | 2 | 3}` as const;
        const topicArray = typeof topic === "string" ? [topic] : topic;
        query = query.where(columnName, "in", topicArray);
      });
    }

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
          blockNumber: result.log_blockNumber,
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
          baseFeePerGas: result.block_baseFeePerGas,
          difficulty: result.block_difficulty,
          extraData: result.block_extraData,
          gasLimit: result.block_gasLimit,
          gasUsed: result.block_gasUsed,
          hash: result.block_hash,
          logsBloom: result.block_logsBloom,
          miner: result.block_miner,
          mixHash: result.block_mixHash,
          nonce: result.block_nonce,
          number: result.block_number,
          parentHash: result.block_parentHash,
          receiptsRoot: result.block_receiptsRoot,
          sha3Uncles: result.block_sha3Uncles,
          size: result.block_size,
          stateRoot: result.block_stateRoot,
          timestamp: result.block_timestamp,
          totalDifficulty: result.block_totalDifficulty,
          transactionsRoot: result.block_transactionsRoot,
        },
        transaction: {
          blockHash: result.tx_blockHash,
          blockNumber: result.tx_blockNumber,
          from: result.tx_from,
          gas: result.tx_gas,
          hash: result.tx_hash,
          input: result.tx_input,
          nonce: Number(result.tx_nonce),
          r: result.tx_r,
          s: result.tx_s,
          to: result.tx_to,
          transactionIndex: Number(result.tx_transactionIndex),
          value: result.tx_value,
          v: result.tx_v,
          ...(result.tx_type === "legacy"
            ? {
                type: result.tx_type,
                gasPrice: result.tx_gasPrice,
              }
            : result.tx_type === "eip1559"
            ? {
                type: result.tx_type,
                maxFeePerGas: result.tx_maxFeePerGas,
                maxPriorityFeePerGas: result.tx_maxPriorityFeePerGas,
              }
            : {
                type: result.tx_type,
                gasPrice: result.tx_gasPrice,
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
      .selectAll()
      .where("filterKey", "==", filterKey)
      .execute();

    return results;
  };

  insertFinalizedLogs = async ({
    chainId,
    logs: rpcLogs,
  }: {
    chainId: number;
    logs: RpcLog[];
  }) => {
    const logs: InsertableLog[] = rpcLogs.map((log) => ({
      ...formatRpcLog({ log }),
      chainId,
      finalized: 1,
    }));

    await this.db.insertInto("logs").values(logs).execute();
  };

  insertFinalizedBlock = async ({
    chainId,
    block: rpcBlock,
    transactions: rpcTransactions,
    logFilterRange: { blockNumberToCacheFrom, logFilterKey },
  }: {
    chainId: number;
    block: RpcBlock;
    transactions: RpcTransaction[];
    logFilterRange: {
      blockNumberToCacheFrom: number;
      logFilterKey: string;
    };
  }) => {
    const block: InsertableBlock = {
      ...formatRpcBlock({ block: rpcBlock }),
      chainId,
      finalized: 0,
    };

    const transactions: InsertableTransaction[] = rpcTransactions.map(
      (transaction) => ({
        ...formatRpcTransaction({ transaction }),
        chainId,
        finalized: 0,
      })
    );

    await this.db.transaction().execute(async (tx) => {
      await tx.insertInto("blocks").values(block).execute();
      await tx.insertInto("transactions").values(transactions).execute();

      const existingRanges = await tx
        .deleteFrom("logFilterCachedRanges")
        .where("filterKey", "==", logFilterKey)
        .returningAll()
        .execute();

      const newRange = {
        startBlock: blockNumberToCacheFrom,
        endBlock: Number(block.number),
        endBlockTimestamp: Number(block.timestamp),
      };

      const mergedRanges = merge_intervals([
        ...existingRanges.map((r) => [r.startBlock, r.endBlock]),
        [newRange.startBlock, newRange.endBlock],
      ]).map((range) => {
        const [startBlock, endBlock] = range;

        // For each new merged range, its endBlock will be found EITHER in the newly
        // added range OR among the endBlocks of the removed ranges.
        // Find it so we can propogate the endBlockTimestamp correctly.
        const endBlockTimestamp = [newRange, ...existingRanges].find(
          (old) => old.endBlock === endBlock
        )!.endBlockTimestamp;

        return {
          filterKey: logFilterKey,
          startBlock,
          endBlock,
          endBlockTimestamp,
        };
      });

      await tx
        .insertInto("logFilterCachedRanges")
        .values(mergedRanges)
        .execute();
    });
  };
}
