import type { Block, Log } from "@ethersproject/providers";
import type Sqlite from "better-sqlite3";
import type { Transaction } from "ethers";

import { logger } from "@/common/logger";

import type { BaseCacheStore, ContractMetadata } from "./baseCacheStore";

export class SqliteCacheStore implements BaseCacheStore {
  db: Sqlite.Database;

  constructor(db: Sqlite.Database) {
    this.db = db;
  }

  migrate = async () => {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS metadata (
        \`contractAddress\` TEXT PRIMARY KEY,
        \`startBlock\` INT NOT NULL,
        \`endBlock\` INT NOT NULL
      )`
      )
      .run();

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

  getContractMetadata = async (contractAddress: string) => {
    const result = this.db
      .prepare(
        `SELECT * FROM \`metadata\` WHERE \`contractAddress\` = @contractAddress`
      )
      .get({
        contractAddress: contractAddress,
      });

    if (!result) return null;

    const contractMetadata = result as ContractMetadata;

    return contractMetadata;
  };

  getCachedBlockRange = async (contractAddresses: string[]) => {
    const result = this.db
      .prepare(
        `SELECT * FROM \`metadata\` WHERE \`contractAddress\` IN (${contractAddresses
          .map((c) => `'${c}'`)
          .join(",")})`
      )
      .all();

    if (!result || result.length === 0) return null;

    const contractMetadatas = result as ContractMetadata[];

    return {
      maxStartBlock: Math.min(...contractMetadatas.map((m) => m.startBlock)),
      minEndBlock: Math.max(...contractMetadatas.map((m) => m.endBlock)),
    };
  };

  upsertContractMetadata = async (attributes: ContractMetadata) => {
    const columnStatements = Object.entries(attributes).map(
      ([fieldName, value]) => {
        return {
          column: `\`${fieldName}\``,
          value: `'${value}'`,
        };
      }
    );

    const insertFragment = `(${columnStatements
      .map((s) => s.column)
      .join(", ")}) values (${columnStatements
      .map((s) => s.value)
      .join(", ")})`;

    const updateFragment = columnStatements
      .filter((s) => s.column !== "id")
      .map((s) => `${s.column}=excluded.${s.column}`)
      .join(", ");

    const statement = `insert into \`metadata\` ${insertFragment} on conflict(\`contractAddress\`) do update set ${updateFragment} returning *`;
    const upsertedEntity = this.db.prepare(statement).get() as ContractMetadata;

    return upsertedEntity;
  };

  upsertLog = async (log: Log) => {
    try {
      this.db
        .prepare(
          `INSERT INTO logs (\`id\`, \`blockNumber\`, \`address\`, \`data\`) VALUES (@id, @blockNumber, @address, @data)
           ON CONFLICT(\`id\`) DO UPDATE SET
            \`blockNumber\`=excluded.\`blockNumber\`,
            \`address\`=excluded.\`address\`,
            \`data\`=excluded.\`data\`
           RETURNING *
          `
        )
        .run({
          id: `${log.blockHash}-${log.logIndex}`,
          blockNumber: log.blockNumber,
          address: log.address,
          data: JSON.stringify(log),
        });
    } catch (err) {
      logger.warn({ err });
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
      logger.warn({ err });
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
        logger.warn({ err });
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
      logger.warn({ err });
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
