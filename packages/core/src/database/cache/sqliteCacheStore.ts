import { Address } from "abitype";
import type Sqlite from "better-sqlite3";
import { Hex } from "viem";

import type { Block, Log, Transaction } from "@/common/types";
import { merge_intervals } from "@/common/utils";

import type {
  CacheStore,
  ContractCall,
  LogFilterCachedRange,
} from "./cacheStore";
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

export const SQLITE_TABLE_PREFIX = "__ponder__v3__";

const logFilterCachedRangesTableName = `${SQLITE_TABLE_PREFIX}logFilterCachedRanges`;
const logsTableName = `${SQLITE_TABLE_PREFIX}logs`;
const blocksTableName = `${SQLITE_TABLE_PREFIX}blocks`;
const transactionsTableName = `${SQLITE_TABLE_PREFIX}transactions`;
const contractCallsTableName = `${SQLITE_TABLE_PREFIX}contractCalls`;

// There are some quirks about the way the SQLite persists data that require
// slightly different types. Specifically, bigints larger than 9223372036854775807
// must be persisted as strings, and any fields than can be undefined on the objects
// coming from viem (notably the transaction fee parameters) must be explcitly defined
// as `null` rather than `undefined`.

export class SqliteCacheStore implements CacheStore {
  db: Sqlite.Database;

  constructor({ db }: { db: Sqlite.Database }) {
    this.db = db;
  }

  migrate = async () => {
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "${logFilterCachedRangesTableName}" (
          "id" INTEGER PRIMARY KEY,
          "filterKey" TEXT NOT NULL,
          "startBlock" INTEGER NOT NULL,
          "endBlock" INTEGER NOT NULL,
          "endBlockTimestamp" INTEGER NOT NULL
        )
        `
      )
      .run();
    this.db
      .prepare(
        `
        CREATE INDEX IF NOT EXISTS "${logFilterCachedRangesTableName}FilterKey"
        ON "${logFilterCachedRangesTableName}" ("filterKey")
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "${logsTableName}" (
          "logId" TEXT PRIMARY KEY,
          "logSortKey" INTEGER NOT NULL,
          "address" TEXT NOT NULL,
          "data" TEXT NOT NULL,
          "topic0" TEXT,
          "topic1" TEXT,
          "topic2" TEXT,
          "topic3" TEXT,
          "blockHash" TEXT NOT NULL,
          "blockNumber" INTEGER NOT NULL,
          "logIndex" INTEGER NOT NULL,
          "transactionHash" TEXT NOT NULL,
          "transactionIndex" INTEGER NOT NULL,
          "removed" INTEGER NOT NULL,
          "blockTimestamp" INTEGER,
          "chainId" INT NOT NULL
        )
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE INDEX IF NOT EXISTS "${logsTableName}Address"
        ON "${logsTableName}" ("address")
        `
      )
      .run();
    this.db
      .prepare(
        `
        CREATE INDEX IF NOT EXISTS "${logsTableName}Topic0"
        ON "${logsTableName}" ("topic0")
        `
      )
      .run();
    this.db
      .prepare(
        `
        CREATE INDEX IF NOT EXISTS "${logsTableName}BlockTimestamp"
        ON "${logsTableName}" ("blockTimestamp")
        `
      )
      .run();
    this.db
      .prepare(
        `
        CREATE INDEX IF NOT EXISTS "${logsTableName}ChainId"
        ON "${logsTableName}" ("chainId")
        `
      )
      .run();

    this.db
      .prepare(
        `
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
        `
      )
      .run();

    this.db
      .prepare(
        `
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
          "chainId" INT
        )
        `
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS "${contractCallsTableName}" (
          "key" TEXT PRIMARY KEY,
          "result" TEXT NOT NULL
        )
        `
      )
      .run();
  };

  getLogFilterCachedRanges = async ({ filterKey }: { filterKey: string }) => {
    const rows = this.db
      .prepare(
        `SELECT * FROM "${logFilterCachedRangesTableName}" WHERE "filterKey" = @filterKey`
      )
      .all({ filterKey }) as LogFilterCachedRange[];

    return rows;
  };

  insertLogFilterCachedRange = async ({
    range: newRange,
  }: {
    range: LogFilterCachedRange;
  }) => {
    const deleteStatement = this.db.prepare<{ filterKey: string }>(`
      DELETE FROM "${logFilterCachedRangesTableName}" WHERE "filterKey" = @filterKey RETURNING *  
    `);

    const insertStatement = this.db.prepare<LogFilterCachedRange>(`
      INSERT INTO "${logFilterCachedRangesTableName}" (
        "filterKey",
        "startBlock",
        "endBlock",
        "endBlockTimestamp"
      ) VALUES (
        @filterKey,
        @startBlock,
        @endBlock,
        @endBlockTimestamp
      )
    `);

    const txn = this.db.transaction((newRange: LogFilterCachedRange) => {
      const { filterKey } = newRange;

      // Delete and return all ranges for this contract
      const existingRanges = deleteStatement.all({ filterKey });

      const mergedRanges: LogFilterCachedRange[] = merge_intervals([
        ...existingRanges.map((r) => [r.startBlock, r.endBlock]),
        [newRange.startBlock, newRange.endBlock],
      ]).map((range) => {
        const [startBlock, endBlock] = range;

        // For each new merged range, its endBlock will be found EITHER in the newly
        // added range OR among the endBlocks of the removed ranges.
        // Find it so we can propogate the endBlockTimestamp correctly.
        const endBlockTimestamp = [newRange, ...existingRanges].find(
          (old) => old.endBlock === endBlock
        )?.endBlockTimestamp;
        if (!endBlockTimestamp) {
          throw new Error(`Old range with endBlock: ${endBlock} not found`);
        }

        return {
          filterKey: newRange.filterKey,
          startBlock,
          endBlock,
          endBlockTimestamp,
        };
      });

      mergedRanges.forEach((m) => {
        insertStatement.run(m);
      });
    });

    txn(newRange);
  };

  insertLogs = async (logs: Log[]) => {
    const insertLog = this.db.prepare(
      `
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
        "removed",
        "chainId"
      ) VALUES (
        @logId,
        @logSortKey,
        @address,
        @data,
        @topic0,
        @topic1,
        @topic2,
        @topic3,
        @blockHash,
        @blockNumber,
        @logIndex,
        @transactionHash,
        @transactionIndex,
        @removed,
        @chainId
      ) ON CONFLICT("logId") DO NOTHING
      `
    );

    const insertLogsTx = this.db.transaction((logs: Log[]) => {
      logs.forEach((log) => {
        insertLog.run(encodeLog(log));
      });
    });

    insertLogsTx(logs);
  };

  insertBlock = async (block: Block) => {
    this.db
      .prepare(
        `
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
      .run(encodeBlock(block));

    this.db
      .prepare(
        `
          UPDATE "${logsTableName}"
          SET "blockTimestamp" = @blockTimestamp
          WHERE "blockHash" = @blockHash
          `
      )
      .run({
        blockHash: block.hash,
        blockTimestamp: block.timestamp,
      });
  };

  insertTransactions = async (transactions: Transaction[]) => {
    const insertTransaction = this.db.prepare(
      `
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

    const insertTransactionsTx = this.db.transaction(
      (transactions: Transaction[]) => {
        transactions.forEach((transaction) => {
          insertTransaction.run(encodeTransaction(transaction));
        });
      }
    );

    insertTransactionsTx(transactions);
  };

  getLogs = async ({
    fromBlockTimestamp,
    toBlockTimestamp,
    chainId,
    address,
    topics,
  }: {
    fromBlockTimestamp: number;
    toBlockTimestamp: number;
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
  }) => {
    let filterStatement = "";
    const filterParams: string[] = [];

    if (address) {
      filterStatement += `AND "address"`;
      if (typeof address === "string") {
        filterStatement += `= ?`;
        filterParams.push(address);
      } else {
        filterStatement += `IN (${[...Array(address.length).keys()].map(
          () => `?`
        )})`;
        filterParams.push(...address);
      }
    }

    (topics ?? []).forEach((topic, index) => {
      filterStatement += `AND "topic${index}"`;
      if (typeof topic === "string") {
        filterStatement += `= ?`;
        filterParams.push(topic);
      } else if (Array.isArray(topic)) {
        filterStatement += `IN (${[...Array(topic.length).keys()].map(
          () => `?`
        )})`;
        filterParams.push(...topic);
      } else {
        filterStatement += `= NULL`;
      }
    });

    const logs: DatabaseLog[] = this.db
      .prepare(
        `
          SELECT * FROM "${logsTableName}"
          WHERE "blockTimestamp" > @fromBlockTimestamp
          AND "blockTimestamp" <= @toBlockTimestamp
          AND "chainId" = @chainId
          ${filterStatement}
          `
      )
      .all(...filterParams, {
        chainId,
        fromBlockTimestamp,
        toBlockTimestamp,
      });

    return logs.map(decodeLog);
  };

  getBlock = async (hash: string) => {
    const block: DatabaseBlock = this.db
      .prepare(
        `
        SELECT * FROM "${blocksTableName}" WHERE "hash" = @hash
        `
      )
      .get({ hash });

    if (!block) return null;

    return decodeBlock(block);
  };

  getTransaction = async (hash: string) => {
    const transaction: DatabaseTransaction = this.db
      .prepare(
        `
        SELECT * FROM "${transactionsTableName}" WHERE "hash" = @hash
        `
      )
      .get({ hash });

    if (!transaction) return null;

    return decodeTransaction(transaction);
  };

  upsertContractCall = async (contractCall: ContractCall) => {
    this.db
      .prepare(
        `
          INSERT INTO "${contractCallsTableName}" ("key", "result")
          VALUES (@key, @result)
          ON CONFLICT("key") DO UPDATE SET
          "result"=excluded."result"
          RETURNING *
          `
      )
      .run(contractCall);
  };

  getContractCall = async (contractCallKey: string) => {
    const result: ContractCall | null = this.db
      .prepare(`SELECT * FROM "${contractCallsTableName}" WHERE "key" = @key`)
      .get({ key: contractCallKey });

    if (!result) return null;

    return result;
  };
}
