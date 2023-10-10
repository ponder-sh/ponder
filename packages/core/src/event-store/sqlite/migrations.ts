import { type Migration, type MigrationProvider, Kysely } from "kysely";

const migrations: Record<string, Migration> = {
  ["2023_05_15_0_initial"]: {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("blocks")
        .addColumn("baseFeePerGas", "blob") // BigInt
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("difficulty", "blob", (col) => col.notNull()) // BigInt
        .addColumn("extraData", "text", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("gasLimit", "blob", (col) => col.notNull()) // BigInt
        .addColumn("gasUsed", "blob", (col) => col.notNull()) // BigInt
        .addColumn("hash", "text", (col) => col.notNull().primaryKey())
        .addColumn("logsBloom", "text", (col) => col.notNull())
        .addColumn("miner", "text", (col) => col.notNull())
        .addColumn("mixHash", "text", (col) => col.notNull())
        .addColumn("nonce", "text", (col) => col.notNull())
        .addColumn("number", "blob", (col) => col.notNull()) // BigInt
        .addColumn("parentHash", "text", (col) => col.notNull())
        .addColumn("receiptsRoot", "text", (col) => col.notNull())
        .addColumn("sha3Uncles", "text", (col) => col.notNull())
        .addColumn("size", "blob", (col) => col.notNull()) // BigInt
        .addColumn("stateRoot", "text", (col) => col.notNull())
        .addColumn("timestamp", "blob", (col) => col.notNull()) // BigInt
        .addColumn("totalDifficulty", "blob", (col) => col.notNull()) // BigInt
        .addColumn("transactionsRoot", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("transactions")
        .addColumn("accessList", "text")
        .addColumn("blockHash", "text", (col) => col.notNull())
        .addColumn("blockNumber", "blob", (col) => col.notNull()) // BigInt
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("from", "text", (col) => col.notNull())
        .addColumn("gas", "blob", (col) => col.notNull()) // BigInt
        .addColumn("gasPrice", "blob") // BigInt
        .addColumn("hash", "text", (col) => col.notNull().primaryKey())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("maxFeePerGas", "blob") // BigInt
        .addColumn("maxPriorityFeePerGas", "blob") // BigInt
        .addColumn("nonce", "integer", (col) => col.notNull())
        .addColumn("r", "text", (col) => col.notNull())
        .addColumn("s", "text", (col) => col.notNull())
        .addColumn("to", "text")
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("value", "blob", (col) => col.notNull()) // BigInt
        .addColumn("v", "blob", (col) => col.notNull()) // BigInt
        .execute();

      await db.schema
        .createTable("logs")
        .addColumn("address", "text", (col) => col.notNull())
        .addColumn("blockHash", "text", (col) => col.notNull())
        .addColumn("blockNumber", "blob", (col) => col.notNull()) // BigInt
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
        .createTable("contractReadResults")
        .addColumn("address", "text", (col) => col.notNull())
        .addColumn("blockNumber", "blob", (col) => col.notNull()) // BigInt
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("data", "text", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("result", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("contractReadResultPrimaryKey", [
          "chainId",
          "blockNumber",
          "address",
          "data",
        ])
        .execute();

      await db.schema
        .createTable("logFilterCachedRanges")
        .addColumn("endBlock", "blob", (col) => col.notNull()) // BigInt
        .addColumn("endBlockTimestamp", "blob", (col) => col.notNull()) // BigInt
        .addColumn("filterKey", "text", (col) => col.notNull())
        // The `id` column should not be included in INSERT statements.
        // This column uses SQLite's ROWID() function (simple autoincrement).
        .addColumn("id", "integer", (col) => col.notNull().primaryKey())
        .addColumn("startBlock", "blob", (col) => col.notNull()) // BigInt
        .execute();
    },
  },
  ["2023_06_20_0_indices"]: {
    async up(db: Kysely<any>) {
      await db.schema
        .createIndex("log_events_index")
        .on("logs")
        .columns(["address", "chainId", "blockHash"])
        .execute();

      await db.schema
        .createIndex("blocks_index")
        .on("blocks")
        .columns(["timestamp", "number"])
        .execute();

      await db.schema
        .createIndex("logFilterCachedRanges_index")
        .on("logFilterCachedRanges")
        .columns(["filterKey"])
        .execute();
    },
  },
  ["2023_07_18_0_better_indices"]: {
    async up(db: Kysely<any>) {
      // Drop old indices.
      await db.schema.dropIndex("log_events_index").execute();
      await db.schema.dropIndex("blocks_index").execute();

      // Block hash is a join key.
      await db.schema
        .createIndex("log_block_hash_index")
        .on("logs")
        .column("blockHash")
        .execute();

      // Chain ID, address and topic0 are all used in WHERE clauses.
      await db.schema
        .createIndex("log_chain_id_index")
        .on("logs")
        .column("chainId")
        .execute();
      await db.schema
        .createIndex("log_address_index")
        .on("logs")
        .column("address")
        .execute();
      await db.schema
        .createIndex("log_topic0_index")
        .on("logs")
        .column("topic0")
        .execute();

      // Block timestamp and number are both used in WHERE and SORT clauses.
      await db.schema
        .createIndex("block_timestamp_index")
        .on("blocks")
        .column("timestamp")
        .execute();
      await db.schema
        .createIndex("block_number_index")
        .on("blocks")
        .column("number")
        .execute();
    },
  },
  ["2023_07_24_0_drop_finalized"]: {
    async up(db: Kysely<any>) {
      await db.schema.alterTable("blocks").dropColumn("finalized").execute();
      await db.schema
        .alterTable("transactions")
        .dropColumn("finalized")
        .execute();
      await db.schema.alterTable("logs").dropColumn("finalized").execute();
      await db.schema
        .alterTable("contractReadResults")
        .dropColumn("finalized")
        .execute();
    },
  },
  ["2023_09_19_0_new_sync_design"]: {
    async up(db: Kysely<any>) {
      /** This table is no longer being used. */
      await db.schema.dropTable("logFilterCachedRanges").execute();

      /** Add new log filter and factory contract interval tables. */
      await db.schema
        .createTable("logFilters")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${address_}_${topic0_}_${topic1_}_${topic2_}_${topic3_}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(66)")
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .addUniqueConstraint("logFiltersUnique", ["id", "chainId"])
        .execute();
      await db.schema
        .createTable("logFilterIntervals")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("logFilterId", "text", (col) =>
          col.notNull().references("logFilters.id")
        )
        .addColumn("startBlock", "blob", (col) => col.notNull()) // BigInt
        .addColumn("endBlock", "blob", (col) => col.notNull()) // BigInt
        .execute();
      await db.schema
        .createTable("factoryContracts")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(66)", (col) => col.notNull())
        .addColumn("eventSelector", "varchar(66)", (col) => col.notNull())
        .addUniqueConstraint("factoryContractsUnique", [
          "chainId",
          "address",
          "eventSelector",
        ])
        .execute();
      await db.schema
        .createTable("factoryContractIntervals")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryContractId", "integer", (col) =>
          col.notNull().references("factoryContracts.id")
        )
        .addColumn("startBlock", "blob", (col) => col.notNull()) // BigInt
        .addColumn("endBlock", "blob", (col) => col.notNull()) // BigInt
        .execute();
      await db.schema
        .createTable("childContracts")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryContractId", "integer", (col) =>
          col.notNull().references("factoryContracts.id")
        )
        .addColumn("address", "varchar(66)", (col) => col.notNull())
        .addColumn("creationBlock", "blob", (col) => col.notNull()) // BigInt
        .execute();
      await db.schema
        .createTable("childContractIntervals")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryContractId", "integer", (col) =>
          col.notNull().references("factoryContracts.id")
        )
        .addColumn("startBlock", "blob", (col) => col.notNull()) // BigInt
        .addColumn("endBlock", "blob", (col) => col.notNull()) // BigInt
        .execute();
    },
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();
