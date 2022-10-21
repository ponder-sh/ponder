import type Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import { merge_intervals } from "@/common/utils";
import type { Block, EventLog, Transaction } from "@/types";

import type { CachedInterval, CacheStore, ContractCall } from "./cacheStore";

export class SqliteCacheStore implements CacheStore {
  db: Sqlite.Database;

  constructor(db: Sqlite.Database) {
    this.db = db;
    this.db.pragma("journal_mode = WAL");
  }

  migrate = async () => {
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "cachedIntervals" (
          "id" INTEGER PRIMARY KEY,
          "contractAddress" TEXT NOT NULL,
          "startBlock" INTEGER NOT NULL,
          "endBlock" INTEGER NOT NULL
        )
        `
      )
      .run();
    this.db
      .prepare(
        `
        CREATE INDEX IF NOT EXISTS "cachedIntervalsContractAddress"
        ON "cachedIntervals" ("contractAddress")
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "logs" (
          "logId" TEXT PRIMARY KEY,
          "logSortKey" INTEGER NOT NULL,
          "address" TEXT NOT NULL,
          "data" TEXT NOT NULL,
          "topics" TEXT NOT NULL,
          "blockHash" TEXT NOT NULL,
          "blockNumber" INTEGER NOT NULL,
          "logIndex" INTEGER NOT NULL,
          "transactionHash" TEXT NOT NULL,
          "transactionIndex" INTEGER NOT NULL,
          "removed" INTEGER NOT NULL
        )
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "blocks" (
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
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "transactions" (
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
          "chainId" INT
        )
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "contractCalls" (
          "key" TEXT PRIMARY KEY,
          "result" TEXT NOT NULL
        )
        `
      )
      .run();
  };

  getCachedIntervals = async (contractAddress: string) => {
    const cachedIntervalRows = this.db
      .prepare(
        `
        SELECT * FROM "cachedIntervals" WHERE "contractAddress" = @contractAddress
        `
      )
      .all({
        contractAddress: contractAddress,
      }) as CachedInterval[];

    return cachedIntervalRows;
  };

  insertCachedInterval = async (interval: CachedInterval) => {
    const deleteIntervals = this.db.prepare(`
      DELETE FROM "cachedIntervals" WHERE "contractAddress" = @contractAddress RETURNING *  
    `);

    const insertInterval = this.db.prepare(`
      INSERT INTO "cachedIntervals" (
        "contractAddress",
        "startBlock",
        "endBlock"
      ) VALUES (
        @contractAddress,
        @startBlock,
        @endBlock
      )
    `);

    const insertIntervalTxn = this.db.transaction(
      (newInterval: CachedInterval) => {
        // Delete and return all intervals for this contract
        const existingIntervalRows = deleteIntervals.all({
          contractAddress: interval.contractAddress,
        }) as CachedInterval[];

        const mergedIntervals = merge_intervals([
          ...existingIntervalRows.map((row) => [row.startBlock, row.endBlock]),
          [newInterval.startBlock, newInterval.endBlock],
        ]);

        mergedIntervals.forEach((interval) => {
          insertInterval.run({
            contractAddress: newInterval.contractAddress,
            startBlock: interval[0],
            endBlock: interval[1],
          });
        });
      }
    );

    try {
      insertIntervalTxn(interval);
    } catch (err) {
      logger.warn({ err });
    }
  };

  insertLogs = async (logs: EventLog[]) => {
    const insertLog = this.db.prepare(
      `
      INSERT INTO "logs" (
        "logId",
        "logSortKey",
        "address",
        "data",
        "topics",
        "blockHash",
        "blockNumber",
        "logIndex",
        "transactionHash",
        "transactionIndex",
        "removed"
      ) VALUES (
        @logId,
        @logSortKey,
        @address,
        @data,
        @topics,
        @blockHash,
        @blockNumber,
        @logIndex,
        @transactionHash,
        @transactionIndex,
        @removed
      ) ON CONFLICT("logId") DO NOTHING
      `
    );

    const insertLogsTxn = this.db.transaction((logs: EventLog[]) => {
      logs.forEach((log) => insertLog.run(log));
    });

    try {
      insertLogsTxn(logs);
    } catch (err) {
      logger.warn({ err });
    }
  };

  insertBlock = async (block: Block) => {
    try {
      this.db
        .prepare(
          `
          INSERT INTO "blocks" (
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
          ) VALUES (
            @hash,
            @number,
            @timestamp,
            @gasLimit,
            @gasUsed,
            @baseFeePerGas,
            @miner,
            @extraData,
            @size,
            @parentHash,
            @stateRoot,
            @transactionsRoot,
            @receiptsRoot,
            @logsBloom,
            @totalDifficulty
          ) ON CONFLICT("hash") DO NOTHING
          `
        )
        .run({ ...block, id: block.hash });
    } catch (err) {
      logger.warn({ err });
    }
  };

  insertTransactions = async (transactions: Transaction[]) => {
    const insertTransaction = this.db.prepare(
      `
      INSERT INTO "transactions" (
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
      ) VALUES (
        @hash,
        @nonce,
        @from,
        @to,
        @value,
        @input,
        @gas,
        @gasPrice,
        @maxFeePerGas,
        @maxPriorityFeePerGas,
        @blockHash,
        @blockNumber,
        @transactionIndex,
        @chainId
      ) ON CONFLICT(\`hash\`) DO NOTHING
      `
    );

    const insertTransactionsTxn = this.db.transaction((txns: Transaction[]) => {
      txns.forEach((txn) => insertTransaction.run(txn));
    });

    try {
      insertTransactionsTxn(transactions);
    } catch (err) {
      logger.warn({ err });
    }
  };

  getLogs = async (addresses: string[], fromBlock: number) => {
    const addressesStatement = `(${addresses.map((a) => `'${a}'`).join(",")})`;

    try {
      const logs = this.db
        .prepare(
          `
          SELECT * FROM logs WHERE "blockNumber" >= @fromBlock AND "address" IN ${addressesStatement}
          `
        )
        .all({
          fromBlock: fromBlock,
        });

      return <EventLog[]>logs;
    } catch (err) {
      logger.warn({ err });
      return [];
    }
  };

  getBlock = async (hash: string) => {
    const block = this.db
      .prepare(
        `
        SELECT * FROM "blocks" WHERE "hash" = @hash
        `
      )
      .get({
        hash: hash,
      });

    if (!block) return null;

    return <Block>block;
  };

  getTransaction = async (hash: string) => {
    const transaction = this.db
      .prepare(
        `
        SELECT * FROM "transactions" WHERE "hash" = @hash
        `
      )
      .get({
        hash: hash,
      });

    if (!transaction) return null;

    return <Transaction>transaction;
  };

  upsertContractCall = async (contractCall: ContractCall) => {
    try {
      this.db
        .prepare(
          `
          INSERT INTO contractCalls ("key", "result")
          VALUES (@key, @result)
          ON CONFLICT("key") DO UPDATE SET
          "result"=excluded."result"
          RETURNING *
          `
        )
        .run({
          key: contractCall.key,
          result: contractCall.result,
        });
    } catch (err) {
      logger.warn({ err });
    }
  };

  getContractCall = async (contractCallKey: string) => {
    const result = this.db
      .prepare(`SELECT * FROM "contractCalls" WHERE "key" = @key`)
      .get({
        key: contractCallKey,
      });

    if (!result) return null;

    const contractCall = result as ContractCall;

    return contractCall;
  };
}
