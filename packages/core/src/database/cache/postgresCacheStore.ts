import type { Pool, PoolClient } from "pg";

import type { Block, Log, Transaction } from "@/common/types";
import { merge_intervals } from "@/common/utils";

import type { CacheStore, ContractCall, LogCacheMetadata } from "./cacheStore";
import {
  DatabaseBlock,
  DatabaseLog,
  DatabaseTransaction,
  decodeBlock,
  decodeLog,
  decodeTransaction,
  encodeBlock,
  encodeLog,
  encodeTransaction,
} from "./mappers";

export const POSTGRES_TABLE_PREFIX = "__ponder__v3__";

const logCacheMetadataTableName = `${POSTGRES_TABLE_PREFIX}logCacheMetadata`;
const logsTableName = `${POSTGRES_TABLE_PREFIX}logs`;
const blocksTableName = `${POSTGRES_TABLE_PREFIX}blocks`;
const transactionsTableName = `${POSTGRES_TABLE_PREFIX}transactions`;
const contractCallsTableName = `${POSTGRES_TABLE_PREFIX}contractCalls`;

export class PostgresCacheStore implements CacheStore {
  pool: Pool;

  constructor({ pool }: { pool: Pool }) {
    this.pool = pool;
  }

  migrate = async () => {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(`
        CREATE TABLE IF NOT EXISTS "${logCacheMetadataTableName}" (
          "id" SERIAL PRIMARY KEY,
          "filterKey" TEXT NOT NULL,
          "startBlock" INTEGER NOT NULL,
          "endBlock" INTEGER NOT NULL,
          "endBlockTimestamp" INTEGER NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "${logCacheMetadataTableName}FilterKey"
        ON "${logCacheMetadataTableName}" ("filterKey")
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS "${logsTableName}" (
          "logId" TEXT PRIMARY KEY,
          "logSortKey" BIGINT NOT NULL,
          "address" TEXT NOT NULL,
          "data" TEXT NOT NULL,
          "topic0" TEXT,
          "topic1" TEXT,
          "topic2" TEXT,
          "topic3" TEXT,
          "blockHash" TEXT NOT NULL,
          "blockNumber" INTEGER NOT NULL,
          "blockTimestamp" INTEGER,
          "logIndex" INTEGER NOT NULL,
          "transactionHash" TEXT NOT NULL,
          "transactionIndex" INTEGER NOT NULL,
          "removed" INTEGER NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "${logsTableName}BlockTimestamp"
        ON "${logsTableName}" ("blockTimestamp")
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "${logsTableName}Topic0"
        ON "${logsTableName}" ("topic0")
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS "${blocksTableName}" (
          "hash" TEXT PRIMARY KEY,
          "number" INTEGER NOT NULL,
          "timestamp" INTEGER NOT NULL,
          "gasLimit" TEXT NOT NULL,
          "gasUsed" TEXT NOT NULL,
          "baseFeePerGas" TEXT NOT NULL,
          "miner" TEXT NOT NULL,
          "extraData" TEXT NOT NULL,
          "size" INTEGER NOT NULL,
          "parentHash" TEXT NOT NULL,
          "stateRoot" TEXT NOT NULL,
          "transactionsRoot" TEXT NOT NULL,
          "receiptsRoot" TEXT NOT NULL,
          "logsBloom" TEXT NOT NULL,
          "totalDifficulty" TEXT NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS "${transactionsTableName}" (
          "hash" TEXT PRIMARY KEY,
          "nonce" INTEGER NOT NULL,
          "from" TEXT NOT NULL,
          "to" TEXT,
          "value" TEXT NOT NULL,
          "input" TEXT NOT NULL,
          "gas" TEXT NOT NULL,
          "gasPrice" TEXT NOT NULL,
          "maxFeePerGas" TEXT,
          "maxPriorityFeePerGas" TEXT,
          "blockHash" TEXT NOT NULL,
          "blockNumber" INTEGER NOT NULL,
          "transactionIndex" INTEGER NOT NULL,
          "chainId" INTEGER
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS "${contractCallsTableName}" (
          "key" TEXT PRIMARY KEY,
          "result" TEXT NOT NULL
        )
      `);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  getLogCacheMetadata = async ({ filterKey }: { filterKey: string }) => {
    const result = await this.pool.query<LogCacheMetadata>(
      `SELECT * FROM "${logCacheMetadataTableName}" WHERE "filterKey" = $1`,
      [filterKey]
    );

    return result.rows;
  };

  insertLogCacheMetadata = async ({
    metadata,
  }: {
    metadata: LogCacheMetadata;
  }) => {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const { rows: existingMetadata } = await client.query<LogCacheMetadata>(
        `DELETE FROM "${logCacheMetadataTableName}" WHERE "filterKey" = $1 RETURNING *`,
        [metadata.filterKey]
      );

      const mergedMetadata: LogCacheMetadata[] = merge_intervals([
        ...existingMetadata.map((m) => [m.startBlock, m.endBlock]),
        [metadata.startBlock, metadata.endBlock],
      ]).map((interval) => {
        const [startBlock, endBlock] = interval;

        // For each new merged interval, its endBlock will be found EITHER in the newly
        // added interval OR among the endBlocks of the removed intervals.
        // Find it so we can propogate the endBlockTimestamp correctly.
        const endBlockTimestamp = [metadata, ...existingMetadata].find(
          (old) => old.endBlock === endBlock
        )?.endBlockTimestamp;
        if (!endBlockTimestamp) {
          throw new Error(`Old interval with endBlock: ${endBlock} not found`);
        }

        return {
          filterKey: metadata.filterKey,
          startBlock,
          endBlock,
          endBlockTimestamp,
        };
      });

      await client.query(
        `
        INSERT INTO "${logCacheMetadataTableName}" (
          "filterKey",
          "startBlock",
          "endBlock",
          "endBlockTimestamp"
        ) VALUES ${this.buildInsertParams(4, mergedMetadata.length)}
        `,
        mergedMetadata.map(Object.values).flat()
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  insertLogs = async (logs: Log[]) => {
    if (logs.length === 0) return;

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const batchSize = 1000;
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        await this.insertLogBatch(client, batch);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  private async insertLogBatch(client: PoolClient, logs: Log[]) {
    const params = logs
      .map((rawLog) => {
        const log = encodeLog(rawLog);
        return [
          log.logId,
          log.logSortKey,
          log.address,
          log.data,
          log.topic0,
          log.topic1,
          log.topic2,
          log.topic3,
          log.blockHash,
          log.blockNumber,
          log.logIndex,
          log.transactionHash,
          log.transactionIndex,
          log.removed,
        ];
      })
      .flat();

    const query = `
      INSERT INTO "${logsTableName}" (
        "logId",
        "logSortKey",
        "address",
        "data",
        "topic0",
        "topic1",
        "topic2",
        "topic3",
        "blockHash",
        "blockNumber",
        "logIndex",
        "transactionHash",
        "transactionIndex",
        "removed"
      ) VALUES ${this.buildInsertParams(14, logs.length)}
      ON CONFLICT("logId") DO NOTHING
    `;

    await client.query(query, params);
  }

  insertBlock = async (rawBlock: Block) => {
    const block = encodeBlock(rawBlock);
    const blockParams = [
      block.hash,
      block.number,
      block.timestamp,
      block.gasLimit,
      block.gasUsed,
      block.baseFeePerGas,
      block.miner,
      block.extraData,
      block.size,
      block.parentHash,
      block.stateRoot,
      block.transactionsRoot,
      block.receiptsRoot,
      block.logsBloom,
      block.totalDifficulty,
    ];
    const blockQuery = `
      INSERT INTO "${blocksTableName}" (
        "hash",
        "number",
        "timestamp",
        "gasLimit",
        "gasUsed",
        "baseFeePerGas",
        "miner",
        "extraData",
        "size",
        "parentHash",
        "stateRoot",
        "transactionsRoot",
        "receiptsRoot",
        "logsBloom",
        "totalDifficulty"
      ) VALUES ${this.buildInsertParams(15, 1)}
      ON CONFLICT("hash") DO NOTHING
    `;

    const logQuery = `
      UPDATE "${logsTableName}"
      SET "blockTimestamp" = $1
      WHERE "blockHash" = $2
    `;
    const logParams = [block.timestamp, block.hash];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(blockQuery, blockParams);
      await client.query(logQuery, logParams);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  insertTransactions = async (transactions: Transaction[]) => {
    if (transactions.length === 0) return;

    const params = transactions
      .map((rawTransaction) => {
        const transaction = encodeTransaction(rawTransaction);
        return [
          transaction.hash,
          transaction.nonce,
          transaction.from,
          transaction.to,
          transaction.value,
          transaction.input,
          transaction.gas,
          transaction.gasPrice,
          transaction.maxFeePerGas,
          transaction.maxPriorityFeePerGas,
          transaction.blockHash,
          transaction.blockNumber,
          transaction.transactionIndex,
          transaction.chainId,
        ];
      })
      .flat();

    const query = `
      INSERT INTO "${transactionsTableName}" (
        "hash",
        "nonce",
        "from",
        "to",
        "value",
        "input",
        "gas",
        "gasPrice",
        "maxFeePerGas",
        "maxPriorityFeePerGas",
        "blockHash",
        "blockNumber",
        "transactionIndex",
        "chainId"
      ) VALUES ${this.buildInsertParams(14, transactions.length)}
      ON CONFLICT("hash") DO NOTHING
    `;

    await this.pool.query(query, params);
  };

  getLogs = async ({
    contractAddress,
    fromBlockTimestamp,
    toBlockTimestamp,
    eventSigHashes,
  }: {
    contractAddress: string;
    fromBlockTimestamp: number;
    toBlockTimestamp: number;
    eventSigHashes?: string[];
  }) => {
    let topicStatement = "";
    let topicParams: string[] = [];
    if (eventSigHashes !== undefined) {
      if (eventSigHashes.length === 0) {
        // Postgres raises an error for `AND "col" IN ()`, this is a workaround.
        // https://stackoverflow.com/questions/63905200/postgresql-in-empty-array-syntax
        topicStatement = `AND "topic0" = ANY (ARRAY[]::text[])`;
      } else {
        topicStatement = `AND "topic0" IN (${[
          ...Array(eventSigHashes.length).keys(),
        ].map((index) => `$${index + 4}`)})`;
      }
      topicParams = eventSigHashes;
    }

    const { rows } = await this.pool.query<DatabaseLog>(
      `
      SELECT * FROM "${logsTableName}"
      WHERE "address" = $1
      AND "blockTimestamp" > $2
      AND "blockTimestamp" <= $3
      ${topicStatement}
      `,
      [contractAddress, fromBlockTimestamp, toBlockTimestamp, ...topicParams]
    );

    return rows.map(decodeLog);
  };

  getBlock = async (hash: string) => {
    const { rows, rowCount } = await this.pool.query<DatabaseBlock>(
      `
      SELECT * FROM "${blocksTableName}" WHERE "hash" = $1
      `,
      [hash]
    );

    if (rowCount == 0) return null;
    return decodeBlock(rows[0]);
  };

  getTransaction = async (hash: string) => {
    const { rows, rowCount } = await this.pool.query<DatabaseTransaction>(
      `
      SELECT * FROM "${transactionsTableName}" WHERE "hash" = $1
      `,
      [hash]
    );

    if (rowCount == 0) return null;
    return decodeTransaction(rows[0]);
  };

  upsertContractCall = async (contractCall: ContractCall) => {
    await this.pool.query(
      `
      INSERT INTO "${contractCallsTableName}" ("key", "result")
      VALUES ($1, $2)
      ON CONFLICT("key") DO NOTHING
      `,
      [contractCall.key, contractCall.result]
    );
  };

  getContractCall = async (contractCallKey: string) => {
    const { rows, rowCount } = await this.pool.query<ContractCall>(
      `SELECT * FROM "${contractCallsTableName}" WHERE "key" = $1`,
      [contractCallKey]
    );

    if (rowCount == 0) return null;
    return rows[0];
  };

  private buildInsertParams = (propertyCount: number, itemCount: number) =>
    [...Array(itemCount).keys()]
      .map(
        (itemIndex) =>
          `(${[...Array(propertyCount).keys()]
            .map(
              (propertyIndex) =>
                `$${itemIndex * propertyCount + (propertyIndex + 1)}`
            )
            .join(",")})`
      )
      .join(",");
}
