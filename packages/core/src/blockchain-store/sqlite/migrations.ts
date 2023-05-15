import { Kysely, Migration, MigrationProvider } from "kysely";

const migrations: Record<string, Migration> = {
  ["2023_05_15_0_initial"]: {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("blocks")
        .addColumn("baseFeePerGas", "integer")
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("difficulty", "integer", (col) => col.notNull())
        .addColumn("extraData", "text", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("gasLimit", "integer", (col) => col.notNull())
        .addColumn("gasUsed", "integer", (col) => col.notNull())
        .addColumn("hash", "text", (col) => col.notNull().primaryKey())
        .addColumn("logsBloom", "text", (col) => col.notNull())
        .addColumn("miner", "text", (col) => col.notNull())
        .addColumn("mixHash", "text", (col) => col.notNull())
        .addColumn("nonce", "text", (col) => col.notNull())
        .addColumn("number", "integer", (col) => col.notNull())
        .addColumn("parentHash", "text", (col) => col.notNull())
        .addColumn("receiptsRoot", "text", (col) => col.notNull())
        .addColumn("sha3Uncles", "text", (col) => col.notNull())
        .addColumn("size", "integer", (col) => col.notNull())
        .addColumn("stateRoot", "text", (col) => col.notNull())
        .addColumn("timestamp", "integer", (col) => col.notNull())
        .addColumn("totalDifficulty", "integer", (col) => col.notNull())
        .addColumn("transactionsRoot", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("transactions")
        .addColumn("blockHash", "text", (col) => col.notNull())
        .addColumn("blockNumber", "integer", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("from", "text", (col) => col.notNull())
        .addColumn("gas", "integer", (col) => col.notNull())
        .addColumn("gasPrice", "integer")
        .addColumn("hash", "text", (col) => col.notNull().primaryKey())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("maxFeePerGas", "integer")
        .addColumn("maxPriorityFeePerGas", "integer")
        .addColumn("nonce", "integer", (col) => col.notNull())
        .addColumn("r", "text", (col) => col.notNull())
        .addColumn("s", "text", (col) => col.notNull())
        .addColumn("to", "text")
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("value", "integer", (col) => col.notNull())
        .addColumn("v", "integer", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("logs")
        .addColumn("address", "text", (col) => col.notNull())
        .addColumn("blockHash", "text", (col) => col.notNull())
        .addColumn("blockNumber", "integer", (col) => col.notNull())
        .addColumn("blockTimestamp", "integer")
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("data", "text", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("logIndex", "integer", (col) => col.notNull())
        .addColumn("topic0", "text")
        .addColumn("topic1", "text")
        .addColumn("topic2", "text")
        .addColumn("topic3", "text")
        .addColumn("transactionHash", "text", (col) => col.notNull())
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("contractCalls")
        .addColumn("address", "text", (col) => col.notNull())
        .addColumn("blockNumber", "integer", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("data", "text", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // Primary key from `${chainId}-${blockNumber}-${address}-${data}`
        .addColumn("result", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("logFilterCachedRanges")
        // The `id` column should not be included in INSERT statements.
        // This column uses SQLite's ROWID() function (simple autoincrement).
        .addColumn("id", "integer", (col) => col.notNull().primaryKey())
        .addColumn("filterKey", "text", (col) => col.notNull())
        .addColumn("startBlock", "integer", (col) => col.notNull())
        .addColumn("endBlock", "integer", (col) => col.notNull())
        .addColumn("endBlockTimestamp", "integer", (col) => col.notNull())
        .execute();
    },
    async down(db: Kysely<any>) {
      await db.schema.dropTable("blocks").execute();
      await db.schema.dropTable("logs").execute();
      await db.schema.dropTable("transactions").execute();
      await db.schema.dropTable("contractCalls").execute();
      await db.schema.dropTable("logFilterCachedRanges").execute();
    },
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();
