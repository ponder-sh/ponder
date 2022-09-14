import { Block, Log } from "@ethersproject/providers";
import Sqlite from "better-sqlite3";
import { Transaction } from "ethers";
import path from "path";

import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";
import { ensureDirectoriesExist } from "@/common/utils";

const { PONDER_DIR_PATH } = CONFIG;

export class CacheStore {
  db: Sqlite.Database;

  constructor() {
    this.db = Sqlite(path.join(PONDER_DIR_PATH, "cache.db"), {
      verbose: logger.debug,
    });
  }

  migrate = async () => {
    this.db.prepare(`DROP TABLE IF EXISTS logs`).run();
    this.db.prepare(`DROP TABLE IF EXISTS blocks`).run();
    this.db.prepare(`DROP TABLE IF EXISTS transactions`).run();

    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS logs (
        \`id\` TEXT PRIMARY KEY,
        \`blockNumber\` INT NOT NULL,
        \`address\` TEXT NOT NULL,
        \`data\` TEXT NOT NULL
      )`
      )
      .run();

    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS blocks (
        \`id\` TEXT PRIMARY KEY,
        \`number\` INT NOT NULL,
        \`data\` TEXT NOT NULL
      )`
      )
      .run();

    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS transactions (
        \`id\` TEXT PRIMARY KEY,
        \`to\` TEXT,
        \`data\` TEXT NOT NULL
      )`
      )
      .run();
  };

  insertLog = async (log: Log) => {
    try {
      this.db
        .prepare(
          `INSERT INTO logs (\`id\`, \`blockNumber\`, \`address\`, \`data\`) VALUES (@id, @blockNumber, @address, @data)`
        )
        .run({
          id: `${log.blockHash}-${log.logIndex}`,
          blockNumber: log.blockNumber,
          address: log.address,
          data: JSON.stringify(log),
        });
    } catch (err) {
      console.log({ err });
    }
  };

  insertBlock = async (block: Block) => {
    try {
      this.db
        .prepare(
          `INSERT INTO blocks (\`id\`, \`number\`, \`data\`) VALUES (@id, @number, @data)`
        )
        .run({
          id: block.hash,
          number: block.number,
          data: JSON.stringify(block),
        });
    } catch (err) {
      console.log({ err });
    }
  };

  insertTransactions = async (transactions: Transaction[]) => {
    transactions.forEach((txn) => {
      try {
        this.db
          .prepare(
            `INSERT INTO transactions (\`id\`, \`to\`, \`data\`) VALUES (@id, @to, @data)`
          )
          .run({
            id: txn.hash,
            to: txn.to,
            data: JSON.stringify(txn),
          });
      } catch (err) {
        console.log({ err });
      }
    });
  };

  getLogs = async (addresses: string[], fromBlock: number) => {
    const addressesStatement = `(${addresses.map((a) => `'${a}'`).join(",")})`;

    try {
      const result: { id: string; data: string }[] = this.db
        .prepare(
          `SELECT * FROM logs WHERE \`blockNumber\` >= @fromBlock AND \`address\` IN ${addressesStatement}`
        )
        .all({
          fromBlock: fromBlock,
        });

      const logs: Log[] = result.map((log) => JSON.parse(log.data));

      return logs;
    } catch (err) {
      console.log({ err });
      return [];
    }
  };

  getBlock = async (blockHash: string) => {
    const result = this.db
      .prepare(`SELECT * FROM \`blocks\` WHERE \`id\` = @id`)
      .get({
        id: blockHash,
      });

    if (!result) return null;

    const block: Block = JSON.parse(result.data);

    return block;
  };

  getTransaction = async (transactionHash: string) => {
    const result = this.db
      .prepare(`SELECT * FROM transactions WHERE \`id\` = @id`)
      .get({
        id: transactionHash,
      });

    if (!result) return null;

    const block: Transaction = JSON.parse(result.data);

    return block;
  };
}

// This is a filthy hack lol. cacheStore probably shouldn't be initialized in global scope?
ensureDirectoriesExist();
export const cacheStore = new CacheStore();
