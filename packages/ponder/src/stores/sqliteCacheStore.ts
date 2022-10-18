import type Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";

import type {
  BaseCacheStore,
  ContractCall,
  ContractMetadata,
} from "./baseCacheStore";
import type { CachedBlock, CachedLog, CachedTransaction } from "./utils";

export class SqliteCacheStore implements BaseCacheStore {
  db: Sqlite.Database;

  constructor(db: Sqlite.Database) {
    this.db = db;
    this.db.pragma("journal_mode = WAL");
  }

  migrate = async () => {
    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS metadata (
          \`contractAddress\` TEXT PRIMARY KEY,
          \`startBlock\` INT NOT NULL,
          \`endBlock\` INT NOT NULL
        )`
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS logs (
          \`logId\` TEXT PRIMARY KEY,
          \`logSortKey\` INT NOT NULL,
          \`address\` TEXT NOT NULL,
          \`data\` TEXT NOT NULL,
          \`topics\` TEXT NOT NULL,
          \`blockHash\` TEXT NOT NULL,
          \`blockNumber\` INT NOT NULL,
          \`logIndex\` INT NOT NULL,
          \`transactionHash\` TEXT NOT NULL,
          \`transactionIndex\` INT NOT NULL,
          \`removed\` INT NOT NULL
        )`
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS blocks (
          \`hash\` TEXT PRIMARY KEY,
          \`number\` INT NOT NULL,
          \`timestamp\` INT NOT NULL,
          \`gasLimit\` TEXT NOT NULL,
          \`gasUsed\` TEXT NOT NULL,
          \`baseFeePerGas\` TEXT NOT NULL,
          \`miner\` TEXT NOT NULL,
          \`extraData\` TEXT NOT NULL,
          \`size\` INT NOT NULL,
          \`parentHash\` TEXT NOT NULL,
          \`stateRoot\` TEXT NOT NULL,
          \`transactionsRoot\` TEXT NOT NULL,
          \`receiptsRoot\` TEXT NOT NULL,
          \`logsBloom\` TEXT NOT NULL,
          \`totalDifficulty\` TEXT NOT NULL
        )`
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS transactions (
          \`hash\` TEXT PRIMARY KEY,
          \`nonce\` INT NOT NULL,
          \`from\` TEXT NOT NULL,
          \`to\` TEXT,
          \`value\` TEXT NOT NULL,
          \`input\` TEXT NOT NULL,
          \`gas\` TEXT NOT NULL,
          \`gasPrice\` TEXT NOT NULL,
          \`maxFeePerGas\` TEXT,
          \`maxPriorityFeePerGas\` TEXT,
          \`blockHash\` TEXT NOT NULL,
          \`blockNumber\` INT NOT NULL,
          \`transactionIndex\` INT NOT NULL,
          \`chainId\` INT
        )`
      )
      .run();

    this.db
      .prepare(
        `
        CREATE TABLE IF NOT EXISTS contractCalls (
          \`key\` TEXT PRIMARY KEY,
          \`result\` TEXT NOT NULL
        )`
      )
      .run();
  };

  getContractMetadata = async (contractAddress: string) => {
    const contractMetadata = this.db
      .prepare(
        `SELECT * FROM \`metadata\` WHERE \`contractAddress\` = @contractAddress`
      )
      .get({
        contractAddress: contractAddress,
      });

    if (!contractMetadata) return null;

    return <ContractMetadata>contractMetadata;
  };

  upsertContractMetadata = async (attributes: ContractMetadata) => {
    const columnStatements = Object.entries(attributes).map(
      ([fieldName, value]) => ({
        column: `\`${fieldName}\``,
        value: `'${value}'`,
      })
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

  insertLogs = async (logs: CachedLog[]) => {
    const insertLog = this.db.prepare(
      `
      INSERT INTO \`logs\` (
        \`logId\`,
        \`logSortKey\`,
        \`address\`,
        \`data\`,
        \`topics\`,
        \`blockHash\`,
        \`blockNumber\`,
        \`logIndex\`,
        \`transactionHash\`,
        \`transactionIndex\`,
        \`removed\`
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
      ) ON CONFLICT(\`logId\`) DO NOTHING
      `
    );

    const insertLogs = this.db.transaction((logs) => {
      for (const log of logs) insertLog.run(log);
    });

    try {
      insertLogs(logs);
    } catch (err) {
      logger.warn({ err });
    }
  };

  insertBlock = async (block: CachedBlock) => {
    try {
      this.db
        .prepare(
          `
          INSERT INTO blocks (
            \`hash\`,
            \`number\`,
            \`timestamp\`,
            \`gasLimit\`,
            \`gasUsed\`,
            \`baseFeePerGas\`,
            \`miner\`,
            \`extraData\`,
            \`size\`,
            \`parentHash\`,
            \`stateRoot\`,
            \`transactionsRoot\`,
            \`receiptsRoot\`,
            \`logsBloom\`,
            \`totalDifficulty\`
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
          ) ON CONFLICT(\`hash\`) DO NOTHING
          `
        )
        .run({ ...block, id: block.hash });
    } catch (err) {
      logger.warn({ err });
    }
  };

  insertTransactions = async (transactions: CachedTransaction[]) => {
    const insertTransaction = this.db.prepare(
      `
      INSERT INTO \`transactions\` (
        \`hash\`,
        \`nonce\`,
        \`from\`,
        \`to\`,
        \`value\`,
        \`input\`,
        \`gas\`,
        \`gasPrice\`,
        \`maxFeePerGas\`,
        \`maxPriorityFeePerGas\`,
        \`blockHash\`,
        \`blockNumber\`,
        \`transactionIndex\`,
        \`chainId\`
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

    const insertTransactions = this.db.transaction((txns) => {
      for (const txn of txns) insertTransaction.run(txn);
    });

    try {
      insertTransactions(transactions);
    } catch (err) {
      logger.warn({ err });
    }
  };

  getLogs = async (addresses: string[], fromBlock: number) => {
    const addressesStatement = `(${addresses.map((a) => `'${a}'`).join(",")})`;

    try {
      const logs = this.db
        .prepare(
          `SELECT * FROM logs WHERE \`blockNumber\` >= @fromBlock AND \`address\` IN ${addressesStatement}`
        )
        .all({
          fromBlock: fromBlock,
        });

      return <CachedLog[]>logs;
    } catch (err) {
      logger.warn({ err });
      return [];
    }
  };

  getBlock = async (hash: string) => {
    const block = this.db
      .prepare(`SELECT * FROM \`blocks\` WHERE \`hash\` = @hash`)
      .get({
        hash: hash,
      });

    if (!block) return null;

    return <CachedBlock>block;
  };

  getTransaction = async (hash: string) => {
    const transaction = this.db
      .prepare(`SELECT * FROM transactions WHERE \`hash\` = @hash`)
      .get({
        hash: hash,
      });

    if (!transaction) return null;

    return <CachedTransaction>transaction;
  };

  upsertContractCall = async (contractCall: ContractCall) => {
    try {
      this.db
        .prepare(
          `
          INSERT INTO contractCalls (\`key\`, \`result\`)
          VALUES (@key, @result)
          ON CONFLICT(\`key\`) DO UPDATE SET
          \`result\`=excluded.\`result\`
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
      .prepare(`SELECT * FROM \`contractCalls\` WHERE \`key\` = @key`)
      .get({
        key: contractCallKey,
      });

    if (!result) return null;

    const contractCall = result as ContractCall;

    return contractCall;
  };
}
