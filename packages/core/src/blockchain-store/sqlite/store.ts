import type Sqlite from "better-sqlite3";
import { Kysely, Migrator, SqliteDialect } from "kysely";
import { RpcBlock, RpcLog, RpcTransaction } from "viem";
import { BlockchainStore } from "../BlockchainStore";
import {
  formatRpcBlock,
  formatRpcLog,
  formatRpcTransaction,
} from "./formatters";
import { migrationProvider } from "./migrations";
import {
  Database,
  InsertableBlock,
  InsertableLog,
  InsertableTransaction,
} from "./schema";

export class SqliteBlockchainStore implements BlockchainStore {
  db: Kysely<Database>;

  constructor({ sqliteDb }: { sqliteDb: Sqlite.Database }) {
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.defaultSafeIntegers(true);

    this.db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: sqliteDb }),
    });
  }

  setup = async () => {
    const migrator = new Migrator({ db: this.db, provider: migrationProvider });

    const { error } = await migrator.migrateToLatest();
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
      log.blockTimestamp = block.timestamp;
      return log;
    });

    await this.db.transaction().execute(async (tx) => {
      await tx.insertInto("blocks").values(block).execute();
      await tx.insertInto("transactions").values(transactions).execute();
      await tx.insertInto("logs").values(logs).execute();
    });
  };

  deleteUnfinalizedData = async ({
    fromBlockNumber,
  }: {
    fromBlockNumber: number;
  }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .deleteFrom("blocks")
        .where("number", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .execute();
      await tx
        .deleteFrom("transactions")
        .where("blockNumber", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .execute();
      await tx
        .deleteFrom("logs")
        .where("blockNumber", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .execute();
      await tx
        .deleteFrom("contractCalls")
        .where("blockNumber", ">=", BigInt(fromBlockNumber))
        .where("finalized", "=", 0)
        .execute();
    });
  };

  finalizeData = async ({ toBlockNumber }: { toBlockNumber: number }) => {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("blocks")
        .set({ finalized: 1 })
        .where("number", "<=", BigInt(toBlockNumber))
        .execute();
      await tx
        .updateTable("transactions")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", BigInt(toBlockNumber))
        .execute();
      await tx
        .updateTable("logs")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", BigInt(toBlockNumber))
        .execute();
      await tx
        .updateTable("contractCalls")
        .set({ finalized: 1 })
        .where("blockNumber", "<=", BigInt(toBlockNumber))
        .execute();
    });
  };
}
