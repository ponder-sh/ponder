import type { Pool } from "pg";

import { logger } from "@/common/logger";
import { merge_intervals } from "@/common/utils";
import type { Block, Log, Transaction } from "@/types";

import type { CachedInterval, CacheStore, ContractCall } from "./cacheStore";

const POSTGRES_TABLE_PREFIX = "__ponder__v2__";

const cachedIntervalsTableName = `${POSTGRES_TABLE_PREFIX}cachedIntervals`;
const logsTableName = `${POSTGRES_TABLE_PREFIX}logs`;
const blocksTableName = `${POSTGRES_TABLE_PREFIX}blocks`;
const transactionsTableName = `${POSTGRES_TABLE_PREFIX}transactions`;
const contractCallsTableName = `${POSTGRES_TABLE_PREFIX}contractCalls`;

const buildInsertParams = (propertyCount: number, itemCount: number) =>
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
        CREATE TABLE IF NOT EXISTS "${cachedIntervalsTableName}" (
          "id" SERIAL PRIMARY KEY,
          "contractAddress" TEXT NOT NULL,
          "startBlock" INTEGER NOT NULL,
          "endBlock" INTEGER NOT NULL,
          "endBlockTimestamp" INTEGER NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS "${cachedIntervalsTableName}ContractAddress"
        ON "${cachedIntervalsTableName}" ("contractAddress")
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

  getCachedIntervals = async (contractAddress: string) => {
    const result = await this.pool.query<CachedInterval>(
      `
      SELECT * FROM "${cachedIntervalsTableName}" WHERE "contractAddress" = $1
      `,
      [contractAddress]
    );

    return result.rows;
  };

  insertCachedInterval = async (newInterval: CachedInterval) => {
    const { contractAddress } = newInterval;
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const { rows: existingIntervals } = await client.query<CachedInterval>(
        `
        DELETE FROM "${cachedIntervalsTableName}" WHERE "contractAddress" = $1 RETURNING *
        `,
        [contractAddress]
      );

      // Handle the special case where there were no existing intervals.
      if (existingIntervals.length === 0) {
        await client.query(
          `
          INSERT INTO "${cachedIntervalsTableName}" (
            "contractAddress",
            "startBlock",
            "endBlock",
            "endBlockTimestamp"
          ) VALUES ($1, $2, $3, $4)
          `,
          [
            contractAddress,
            newInterval.startBlock,
            newInterval.endBlock,
            newInterval.endBlockTimestamp,
          ]
        );
        await client.query("COMMIT");
        return;
      }

      const mergedIntervals = merge_intervals([
        ...existingIntervals.map((row) => [row.startBlock, row.endBlock]),
        [newInterval.startBlock, newInterval.endBlock],
      ]);

      await Promise.all(
        mergedIntervals.map(async (mergedInterval) => {
          const startBlock = mergedInterval[0];
          const endBlock = mergedInterval[1];

          // For each new merged interval, its endBlock will be found EITHER in the newly
          // added interval OR among the endBlocks of the removed intervals.
          // Find it so we can propogate the endBlockTimestamp correctly.
          const endBlockInterval = [newInterval, ...existingIntervals].find(
            (oldInterval) => oldInterval.endBlock === endBlock
          );
          if (!endBlockInterval) {
            logger.error("Old interval with endBlock not found:", {
              existingIntervals,
              endBlock,
            });
            throw new Error(`Old interval with endBlock not found`);
          }
          const { endBlockTimestamp } = endBlockInterval;

          await client.query(
            `
            INSERT INTO "${cachedIntervalsTableName}" (
              "contractAddress",
              "startBlock",
              "endBlock",
              "endBlockTimestamp"
            ) VALUES ($1, $2, $3, $4)
            `,
            [contractAddress, startBlock, endBlock, endBlockTimestamp]
          );
        })
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

    const params = logs
      .map((log) => [
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
      ])
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
      ) VALUES ${buildInsertParams(14, logs.length)}
      ON CONFLICT("logId") DO NOTHING
    `;

    await this.pool.query(query, params);
  };

  insertBlock = async (block: Block) => {
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
      ) VALUES ${buildInsertParams(15, 1)}
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
      .map((transaction) => [
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
      ])
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
      ) VALUES ${buildInsertParams(14, transactions.length)}
      ON CONFLICT("hash") DO NOTHING
    `;

    await this.pool.query(query, params);
  };

  getLogs = async (
    address: string,
    fromBlockTimestamp: number,
    toBlockTimestamp: number
  ) => {
    const { rows } = await this.pool.query<Log>(
      `
      SELECT * FROM "${logsTableName}"
      WHERE "address" = $1
      AND "blockTimestamp" > $2
      AND "blockTimestamp" <= $3
      `,
      [address, fromBlockTimestamp, toBlockTimestamp]
    );

    // For some reason, the log.logSortKey field comes as a string even though
    // the column type is a bigint.
    return rows.map((log) => ({
      ...log,
      logSortKey: parseInt(log.logSortKey as unknown as string),
    }));
  };

  getBlock = async (hash: string) => {
    const { rows, rowCount } = await this.pool.query<Block>(
      `
      SELECT * FROM "${blocksTableName}" WHERE "hash" = $1
      `,
      [hash]
    );

    if (rowCount == 0) return null;
    return rows[0];
  };

  getTransaction = async (hash: string) => {
    const { rows, rowCount } = await this.pool.query<Transaction>(
      `
      SELECT * FROM "${transactionsTableName}" WHERE "hash" = $1
      `,
      [hash]
    );

    if (rowCount == 0) return null;
    return rows[0];
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
}
