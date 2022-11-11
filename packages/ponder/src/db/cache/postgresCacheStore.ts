import type PgPromise from "pg-promise";

import { logger } from "@/common/logger";
import type { Block, EventLog, Transaction } from "@/common/types";
import { merge_intervals } from "@/common/utils";

import type { CachedInterval, CacheStore, ContractCall } from "./cacheStore";

export class PostgresCacheStore implements CacheStore {
  pgp: PgPromise.IMain;
  db: PgPromise.IDatabase<unknown>;

  logsColumnSet: PgPromise.ColumnSet;
  transactionsColumnSet: PgPromise.ColumnSet;

  constructor(pgp: PgPromise.IMain, db: PgPromise.IDatabase<unknown>) {
    this.pgp = pgp;
    this.db = db;

    this.logsColumnSet = new this.pgp.helpers.ColumnSet(
      [
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
        "removed",
      ],
      { table: "logs" }
    );

    this.transactionsColumnSet = new this.pgp.helpers.ColumnSet(
      [
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
        "chainId",
      ],
      { table: "transactions" }
    );
  }

  migrate = async () => {
    await this.db.task("migrate", async (t) => {
      await t.none(
        `
        CREATE TABLE IF NOT EXISTS "cachedIntervals" (
          "id" SERIAL PRIMARY KEY,
          "contractAddress" TEXT NOT NULL,
          "startBlock" INTEGER NOT NULL,
          "endBlock" INTEGER NOT NULL,
          "endBlockTimestamp" INTEGER NOT NULL
        )
        `
      );

      await t.none(
        `
        CREATE INDEX IF NOT EXISTS "cachedIntervalsContractAddress"
        ON "cachedIntervals" ("contractAddress")
        `
      );

      await t.none(
        `
        CREATE TABLE IF NOT EXISTS "logs" (
          "logId" TEXT PRIMARY KEY,
          "logSortKey" BIGINT NOT NULL,
          "address" TEXT NOT NULL,
          "data" TEXT NOT NULL,
          "topics" TEXT NOT NULL,
          "blockHash" TEXT NOT NULL,
          "blockNumber" INTEGER NOT NULL,
          "blockTimestamp" INTEGER,
          "logIndex" INTEGER NOT NULL,
          "transactionHash" TEXT NOT NULL,
          "transactionIndex" INTEGER NOT NULL,
          "removed" INTEGER NOT NULL
        )
        `
      );

      await t.none(
        `
        CREATE INDEX IF NOT EXISTS "logsBlockTimestamp"
        ON "logs" ("blockTimestamp")
        `
      );

      await t.none(
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
      );

      await t.none(
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
          "chainId" INTEGER
        )
        `
      );

      await t.none(
        `
        CREATE TABLE IF NOT EXISTS "contractCalls" (
          "key" TEXT PRIMARY KEY,
          "result" TEXT NOT NULL
        )
        `
      );
    });
  };

  getCachedIntervals = async (contractAddress: string) => {
    return await this.db.manyOrNone<CachedInterval>(
      `
      SELECT * FROM "cachedIntervals" WHERE "contractAddress" = $(contractAddress)
      `,
      {
        contractAddress: contractAddress,
      }
    );
  };

  insertCachedInterval = async (newInterval: CachedInterval) => {
    await this.db.tx(async (t) => {
      const { contractAddress } = newInterval;

      const existingIntervals = await t.manyOrNone<CachedInterval>(
        `
        DELETE FROM "cachedIntervals" WHERE "contractAddress" = $(contractAddress) RETURNING *
        `,
        {
          contractAddress: newInterval.contractAddress,
        }
      );

      // Handle the special case where there were no existing intervals.
      if (existingIntervals.length === 0) {
        await t.none(
          `
          INSERT INTO "cachedIntervals" (
            "contractAddress",
            "startBlock",
            "endBlock",
            "endBlockTimestamp"
          ) VALUES (
            $(contractAddress),
            $(startBlock),
            $(endBlock),
            $(endBlockTimestamp)
          )
          `,
          newInterval
        );
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

          await t.none(
            `
            INSERT INTO "cachedIntervals" (
              "contractAddress",
              "startBlock",
              "endBlock",
              "endBlockTimestamp"
            ) VALUES (
              $(contractAddress),
              $(startBlock),
              $(endBlock),
              $(endBlockTimestamp)
            )
            `,
            {
              contractAddress,
              startBlock,
              endBlock,
              endBlockTimestamp,
            }
          );
        })
      );
    });
  };

  insertLogs = async (logs: EventLog[]) => {
    if (logs.length === 0) return;

    const query =
      this.pgp.helpers.insert(logs, this.logsColumnSet) +
      `ON CONFLICT("logId") DO NOTHING`;

    await this.db.none(query);
  };

  insertBlock = async (block: Block) => {
    await this.db.none(
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
        $(hash),
        $(number),
        $(timestamp),
        $(gasLimit),
        $(gasUsed),
        $(baseFeePerGas),
        $(miner),
        $(extraData),
        $(size),
        $(parentHash),
        $(stateRoot),
        $(transactionsRoot),
        $(receiptsRoot),
        $(logsBloom),
        $(totalDifficulty)
      ) ON CONFLICT("hash") DO NOTHING
      `,
      { ...block, id: block.hash }
    );

    await this.db.none(
      `
      UPDATE "logs"
      SET "blockTimestamp" = $(blockTimestamp)
      WHERE "blockHash" = $(blockHash)
      `,
      {
        blockHash: block.hash,
        blockTimestamp: block.timestamp,
      }
    );
  };

  insertTransactions = async (transactions: Transaction[]) => {
    if (transactions.length === 0) return;

    const query =
      this.pgp.helpers.insert(transactions, this.transactionsColumnSet) +
      `ON CONFLICT("hash") DO NOTHING`;

    await this.db.none(query);
  };

  getLogs = async (
    address: string,
    fromBlockTimestamp: number,
    toBlockTimestamp: number
  ) => {
    const logs = await this.db.manyOrNone<EventLog>(
      `
      SELECT * FROM logs
      WHERE "address" = $(address)
      AND "blockTimestamp" > $(fromBlockTimestamp)
      AND "blockTimestamp" <= $(toBlockTimestamp)
      `,
      {
        address,
        fromBlockTimestamp,
        toBlockTimestamp,
      }
    );

    // For some reason, the log.logSortKey field comes as a string even though
    // the column type is a bigint.
    return logs.map((log) => ({
      ...log,
      logSortKey: parseInt(log.logSortKey as unknown as string),
    }));
  };

  getBlock = async (hash: string) => {
    return await this.db.oneOrNone<Block>(
      `
      SELECT * FROM "blocks" WHERE "hash" = $(hash)
      `,
      {
        hash: hash,
      }
    );
  };

  getTransaction = async (hash: string) => {
    return await this.db.oneOrNone<Transaction>(
      `
      SELECT * FROM "transactions" WHERE "hash" = $(hash)
      `,
      {
        hash: hash,
      }
    );
  };

  upsertContractCall = async (contractCall: ContractCall) => {
    await this.db.none(
      `
      INSERT INTO "contractCalls" ("key", "result")
      VALUES ($(key), $(result))
      ON CONFLICT("key") DO NOTHING
      `,
      {
        key: contractCall.key,
        result: contractCall.result,
      }
    );
  };

  getContractCall = async (contractCallKey: string) => {
    return await this.db.oneOrNone<ContractCall>(
      `SELECT * FROM "contractCalls" WHERE "key" = $(key)`,
      {
        key: contractCallKey,
      }
    );
  };
}
