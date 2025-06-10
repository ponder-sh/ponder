import { type Logger, createNoopLogger } from "@/internal/logger.js";
import type { Kysely, Migration, MigrationProvider } from "kysely";
import { sql } from "kysely";
import { maxUint256 } from "viem";

let logger = createNoopLogger();

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export function buildMigrationProvider(logger_: Logger) {
  logger = logger_;
  const migrationProvider = new StaticMigrationProvider();
  return migrationProvider;
}

const migrations: Record<string, Migration> = {
  "2023_05_15_0_initial": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("blocks")
        .addColumn("baseFeePerGas", sql`bytea`) // BigInt
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("difficulty", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("extraData", "text", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("gasLimit", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("gasUsed", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("hash", "text", (col) => col.notNull().primaryKey())
        .addColumn("logsBloom", "text", (col) => col.notNull())
        .addColumn("miner", "text", (col) => col.notNull())
        .addColumn("mixHash", "text", (col) => col.notNull())
        .addColumn("nonce", "text", (col) => col.notNull())
        .addColumn("number", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("parentHash", "text", (col) => col.notNull())
        .addColumn("receiptsRoot", "text", (col) => col.notNull())
        .addColumn("sha3Uncles", "text", (col) => col.notNull())
        .addColumn("size", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("stateRoot", "text", (col) => col.notNull())
        .addColumn("timestamp", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("totalDifficulty", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("transactionsRoot", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("transactions")
        .addColumn("accessList", "text")
        .addColumn("blockHash", "text", (col) => col.notNull())
        .addColumn("blockNumber", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("finalized", "integer", (col) => col.notNull()) // Boolean (0 or 1).
        .addColumn("from", "text", (col) => col.notNull())
        .addColumn("gas", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("gasPrice", sql`bytea`) // BigInt
        .addColumn("hash", "text", (col) => col.notNull().primaryKey())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("maxFeePerGas", sql`bytea`) // BigInt
        .addColumn("maxPriorityFeePerGas", sql`bytea`) // BigInt
        .addColumn("nonce", "integer", (col) => col.notNull())
        .addColumn("r", "text", (col) => col.notNull())
        .addColumn("s", "text", (col) => col.notNull())
        .addColumn("to", "text")
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("value", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("v", sql`bytea`, (col) => col.notNull()) // BigInt
        .execute();

      await db.schema
        .createTable("logs")
        .addColumn("address", "text", (col) => col.notNull())
        .addColumn("blockHash", "text", (col) => col.notNull())
        .addColumn("blockNumber", sql`bytea`, (col) => col.notNull()) // BigInt
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
        .addColumn("blockNumber", sql`bytea`, (col) => col.notNull()) // BigInt
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
        .addColumn("endBlock", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("endBlockTimestamp", sql`bytea`, (col) => col.notNull()) // BigInt
        .addColumn("filterKey", "text", (col) => col.notNull())
        // The `id` column should not be included in INSERT statements.
        // This column uses Postgres SERIAL type which autoincrements.
        .addColumn("id", "serial", (col) => col.notNull().primaryKey())
        .addColumn("startBlock", sql`bytea`, (col) => col.notNull()) // BigInt
        .execute();
    },
  },
  "2023_06_20_0_indices": {
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
  "2023_07_18_0_better_indices": {
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
  "2023_07_24_0_drop_finalized": {
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
  "2023_09_19_0_new_sync_design": {
    async up(db: Kysely<any>) {
      /** This table is no longer being used. */
      await db.schema.dropTable("logFilterCachedRanges").execute();

      /** Drop and re-create all tables to fix bigint encoding. */
      await db.schema.dropTable("blocks").execute();
      await db.schema
        .createTable("blocks")
        .addColumn("baseFeePerGas", "numeric(78, 0)")
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("difficulty", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("extraData", "text", (col) => col.notNull())
        .addColumn("gasLimit", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("gasUsed", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("hash", "varchar(66)", (col) => col.notNull().primaryKey())
        .addColumn("logsBloom", "varchar(514)", (col) => col.notNull())
        .addColumn("miner", "varchar(42)", (col) => col.notNull())
        .addColumn("mixHash", "varchar(66)", (col) => col.notNull())
        .addColumn("nonce", "varchar(18)", (col) => col.notNull())
        .addColumn("number", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("parentHash", "varchar(66)", (col) => col.notNull())
        .addColumn("receiptsRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("sha3Uncles", "varchar(66)", (col) => col.notNull())
        .addColumn("size", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("stateRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("timestamp", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("totalDifficulty", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("transactionsRoot", "varchar(66)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("blockTimestampIndex")
        .on("blocks")
        .column("timestamp")
        .execute();
      await db.schema
        .createIndex("blockNumberIndex")
        .on("blocks")
        .column("number")
        .execute();

      await db.schema.dropTable("transactions").execute();
      await db.schema
        .createTable("transactions")
        .addColumn("accessList", "text")
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("from", "varchar(42)", (col) => col.notNull())
        .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("gasPrice", "numeric(78, 0)")
        .addColumn("hash", "varchar(66)", (col) => col.notNull().primaryKey())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("maxFeePerGas", "numeric(78, 0)")
        .addColumn("maxPriorityFeePerGas", "numeric(78, 0)")
        .addColumn("nonce", "integer", (col) => col.notNull())
        .addColumn("r", "varchar(66)", (col) => col.notNull())
        .addColumn("s", "varchar(66)", (col) => col.notNull())
        .addColumn("to", "varchar(42)")
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("value", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("v", "numeric(78, 0)", (col) => col.notNull())
        .execute();

      await db.schema.dropTable("logs").execute();
      await db.schema
        .createTable("logs")
        .addColumn("address", "varchar(42)", (col) => col.notNull())
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("data", "text", (col) => col.notNull())
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("logIndex", "integer", (col) => col.notNull())
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .addColumn("transactionHash", "varchar(66)", (col) => col.notNull())
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("logBlockHashIndex")
        .on("logs")
        .column("blockHash")
        .execute();
      await db.schema
        .createIndex("logChainIdIndex")
        .on("logs")
        .column("chainId")
        .execute();
      await db.schema
        .createIndex("logAddressIndex")
        .on("logs")
        .column("address")
        .execute();
      await db.schema
        .createIndex("logTopic0Index")
        .on("logs")
        .column("topic0")
        .execute();

      await db.schema.dropTable("contractReadResults").execute();
      await db.schema
        .createTable("contractReadResults")
        .addColumn("address", "varchar(42)", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("data", "text", (col) => col.notNull())
        .addColumn("result", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("contractReadResultPrimaryKey", [
          "chainId",
          "blockNumber",
          "address",
          "data",
        ])
        .execute();

      /** Add new log filter and factory contract interval tables. */
      await db.schema
        .createTable("logFilters")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${chainId}_${address}_${topic0}_${topic1}_${topic2}_${topic3}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(66)")
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .execute();
      await db.schema
        .createTable("logFilterIntervals")
        .addColumn("id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("logFilterId", "text", (col) =>
          col.notNull().references("logFilters.id"),
        )
        .addColumn("startBlock", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("endBlock", "numeric(78, 0)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("logFilterIntervalsLogFilterId")
        .on("logFilterIntervals")
        .column("logFilterId")
        .execute();

      await db.schema
        .createTable("factories")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${chainId}_${address}_${eventSelector}_${childAddressLocation}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(42)", (col) => col.notNull())
        .addColumn("eventSelector", "varchar(66)", (col) => col.notNull())
        .addColumn("childAddressLocation", "text", (col) => col.notNull()) // `topic${number}` or `offset${number}`
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .execute();
      await db.schema
        .createTable("factoryLogFilterIntervals")
        .addColumn("id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryId", "text", (col) =>
          col.notNull().references("factories.id"),
        )
        .addColumn("startBlock", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("endBlock", "numeric(78, 0)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("factoryLogFilterIntervalsFactoryId")
        .on("factoryLogFilterIntervals")
        .column("factoryId")
        .execute();
    },
  },
  "2023_11_06_0_new_rpc_cache_design": {
    async up(db: Kysely<any>) {
      await db.schema.dropTable("contractReadResults").execute();

      /**
       * Formatting for "request" field values:
       *
       * eth_call: eth_call_{to}_{data}
       * eth_getBalance: eth_getBalance_{address}
       * eth_getCode: eth_getCode_{address}
       * eth_getStorageAt: eth_getStorageAt_{address}_{slot}
       */
      await db.schema
        .createTable("rpcRequestResults")
        .addColumn("request", "text", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("result", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("rpcRequestResultPrimaryKey", [
          "request",
          "chainId",
          "blockNumber",
        ])
        .execute();
    },
  },
  "2024_01_30_0_change_chain_id_type": {
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("blocks")
        .alterColumn("chainId", (col) => col.setDataType("int8"))
        .execute();

      await db.schema
        .alterTable("transactions")
        .alterColumn("chainId", (col) => col.setDataType("int8"))
        .execute();

      await db.schema
        .alterTable("logs")
        .alterColumn("chainId", (col) => col.setDataType("int8"))
        .execute();

      await db.schema
        .alterTable("logFilters")
        .alterColumn("chainId", (col) => col.setDataType("int8"))
        .execute();

      await db.schema
        .alterTable("factories")
        .alterColumn("chainId", (col) => col.setDataType("int8"))
        .execute();

      await db.schema
        .alterTable("rpcRequestResults")
        .alterColumn("chainId", (col) => col.setDataType("int8"))
        .execute();
    },
  },
  "2024_02_1_0_nullable_block_columns": {
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("blocks")
        .alterColumn("mixHash", (col) => col.dropNotNull())
        .execute();
      await db.schema
        .alterTable("blocks")
        .alterColumn("nonce", (col) => col.dropNotNull())
        .execute();
    },
  },
  "2024_03_00_0_log_transaction_hash_index": {
    async up(db: Kysely<any>) {
      await db.schema
        .createIndex("log_transaction_hash_index")
        .on("logs")
        .column("transactionHash")
        .execute();
    },
  },
  "2024_03_13_0_nullable_block_columns_sha3uncles": {
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("blocks")
        .alterColumn("sha3Uncles", (col) => col.dropNotNull())
        .execute();
    },
  },
  "2024_03_14_0_nullable_transaction_rsv": {
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("transactions")
        .alterColumn("r", (col) => col.dropNotNull())
        .execute();
      await db.schema
        .alterTable("transactions")
        .alterColumn("s", (col) => col.dropNotNull())
        .execute();
      await db.schema
        .alterTable("transactions")
        .alterColumn("v", (col) => col.dropNotNull())
        .execute();
    },
  },
  "2024_03_20_0_checkpoint_in_logs_table": {
    async up(_db: Kysely<any>) {
      // no-op migration to avoid crashing databases that successfully ran this migration
      return;
    },
  },
  "2024_04_04_0_log_events_indexes": {
    async up(db: Kysely<any>) {
      await db.schema.dropIndex("blockNumberIndex").ifExists().execute();
      await db.schema.dropIndex("blockTimestampIndex").ifExists().execute();

      await db.schema
        .createIndex("logBlockNumberIndex")
        .on("logs")
        .column("blockNumber")
        .execute();
    },
  },
  "2024_04_14_0_nullable_block_total_difficulty": {
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("blocks")
        .alterColumn("totalDifficulty", (col) => col.dropNotNull())
        .execute();
    },
  },
  "2024_04_14_1_add_checkpoint_column_to_logs_table": {
    async up(db: Kysely<any>) {
      await db.executeQuery(
        sql`
        ALTER TABLE ponder_sync.logs 
        ADD COLUMN IF NOT EXISTS 
        checkpoint varchar(75)`.compile(db),
      );
    },
  },
  "2024_04_14_2_set_checkpoint_in_logs_table": {
    async up(db: Kysely<any>) {
      await db.executeQuery(sql`SET statement_timeout = 3600000;`.compile(db));
      await db.executeQuery(
        sql`
        CREATE TEMP TABLE cp_vals AS 
        SELECT
          logs.id,
          (lpad(blocks.timestamp::text, 10, '0') ||
          lpad(blocks."chainId"::text, 16, '0') ||
          lpad(blocks.number::text, 16, '0') ||
          lpad(logs."transactionIndex"::text, 16, '0') ||
          '5' ||
          lpad(logs."logIndex"::text, 16, '0')) AS checkpoint
        FROM ponder_sync.logs logs
        JOIN ponder_sync.blocks blocks ON logs."blockHash" = blocks.hash;
        `.compile(db),
      );

      await db.executeQuery(
        sql`
        CREATE INDEX ON cp_vals(id)
        `.compile(db),
      );

      await db.executeQuery(
        sql`
          UPDATE ponder_sync.logs
          SET checkpoint=cp_vals.checkpoint
          FROM cp_vals
          WHERE ponder_sync.logs.id = cp_vals.id
        `.compile(db),
      );

      await db.executeQuery(
        sql`DROP TABLE IF EXISTS cp_vals CASCADE;`.compile(db),
      );
    },
  },
  "2024_04_14_3_index_on_logs_checkpoint": {
    async up(db: Kysely<any>) {
      await db.schema
        .createIndex("logs_checkpoint_index")
        .ifNotExists()
        .on("logs")
        .column("checkpoint")
        .execute();
    },
  },
  "2024_04_22_0_transaction_receipts": {
    async up(db: Kysely<any>) {
      // Update the log filter ID keys to include the integer includeTransactionReceipts value.
      // Note that we have to remove the FK constraint, which is fine given our app logic.
      await db.schema
        .alterTable("logFilterIntervals")
        .dropConstraint("logFilterIntervals_logFilterId_fkey")
        .execute();
      await db
        .updateTable("logFilters")
        .set({ id: sql`"id" || '_0'` })
        .execute();
      await db
        .updateTable("logFilterIntervals")
        .set({ logFilterId: sql`"logFilterId" || '_0'` })
        .execute();
      // Add the includeTransactionReceipts column. By setting a default in the ADD COLUMN statement,
      // Postgres will automatically populate all existing rows with the default value. But, we don't
      // actually want a default (want to require a value on insertion), so immediately drop the default.
      await db.schema
        .alterTable("logFilters")
        .addColumn("includeTransactionReceipts", "integer", (col) =>
          col.notNull().defaultTo(0),
        )
        .execute();
      await db.schema
        .alterTable("logFilters")
        .alterColumn("includeTransactionReceipts", (col) => col.dropDefault())
        .execute();

      // Repeat the same 2 steps for the factory tables.
      await db.schema
        .alterTable("factoryLogFilterIntervals")
        .dropConstraint("factoryLogFilterIntervals_factoryId_fkey")
        .execute();
      await db
        .updateTable("factories")
        .set({ id: sql`"id" || '_0'` })
        .execute();
      await db
        .updateTable("factoryLogFilterIntervals")
        .set({ factoryId: sql`"factoryId" || '_0'` })
        .execute();
      await db.schema
        .alterTable("factories")
        .addColumn("includeTransactionReceipts", "integer", (col) =>
          col.notNull().defaultTo(0),
        )
        .execute();
      await db.schema
        .alterTable("factories")
        .alterColumn("includeTransactionReceipts", (col) => col.dropDefault())
        .execute();

      await db.schema
        .createTable("transactionReceipts")
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("contractAddress", "varchar(66)")
        .addColumn("cumulativeGasUsed", "numeric(78, 0)", (col) =>
          col.notNull(),
        )
        .addColumn("effectiveGasPrice", "numeric(78, 0)", (col) =>
          col.notNull(),
        )
        .addColumn("from", "varchar(42)", (col) => col.notNull())
        .addColumn("gasUsed", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("logs", "text", (col) => col.notNull())
        .addColumn("logsBloom", "varchar(514)", (col) => col.notNull())
        .addColumn("status", "text", (col) => col.notNull())
        .addColumn("to", "varchar(42)")
        .addColumn("transactionHash", "varchar(66)", (col) =>
          col.notNull().primaryKey(),
        )
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .execute();
    },
  },
  "2024_04_23_0_block_filters": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("blockFilters")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${chainId}_${interval}_${offset}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("interval", "integer", (col) => col.notNull())
        .addColumn("offset", "integer", (col) => col.notNull())
        .execute();
      await db.schema
        .createTable("blockFilterIntervals")
        .addColumn("id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("blockFilterId", "text", (col) =>
          col.notNull().references("blockFilters.id"),
        )
        .addColumn("startBlock", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("endBlock", "numeric(78, 0)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("blockFilterIntervalsBlockFilterId")
        .on("blockFilterIntervals")
        .column("blockFilterId")
        .execute();

      await db.schema
        .alterTable("blocks")
        .addColumn("checkpoint", "varchar(75)")
        .execute();

      await db.executeQuery(
        sql`
          CREATE TEMP TABLE bcp_vals AS 
          SELECT
            blocks.hash,
            (lpad(blocks.timestamp::text, 10, '0') ||
            lpad(blocks."chainId"::text, 16, '0') ||
            lpad(blocks.number::text, 16, '0') ||
            '9999999999999999' ||
            '5' ||
            '0000000000000000') AS checkpoint
          FROM ponder_sync.blocks
          `.compile(db),
      );

      await db.executeQuery(
        sql`
          UPDATE ponder_sync.blocks
          SET checkpoint=bcp_vals.checkpoint
          FROM bcp_vals
          WHERE ponder_sync.blocks.hash = bcp_vals.hash
        `.compile(db),
      );

      await db.executeQuery(
        sql`DROP TABLE IF EXISTS bcp_vals CASCADE;`.compile(db),
      );

      await db.schema
        .alterTable("blocks")
        .alterColumn("checkpoint", (col) => col.setNotNull())
        .execute();

      // The blocks.number index supports getEvents and deleteRealtimeData
      await db.schema
        .createIndex("blockNumberIndex")
        .on("blocks")
        .column("number")
        .execute();
      // The blocks.chainId index supports getEvents and deleteRealtimeData
      await db.schema
        .createIndex("blockChainIdIndex")
        .on("blocks")
        .column("chainId")
        .execute();
      // The blocks.checkpoint index supports getEvents
      await db.schema
        .createIndex("blockCheckpointIndex")
        .on("blocks")
        .column("checkpoint")
        .execute();
    },
  },
  "2024_05_07_0_trace_filters": {
    async up(db: Kysely<any>) {
      // TODO(kyle) drop foreign key constraint on "blockFilterIntervals.blockFilterId".

      await db.schema
        .createTable("traceFilters")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${chainId}_${fromAddress}_${toAddress}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("fromAddress", "varchar(42)")
        .addColumn("toAddress", "varchar(42)")
        .execute();
      await db.schema
        .createTable("traceFilterIntervals")
        .addColumn("id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("traceFilterId", "text", (col) => col.notNull())
        .addColumn("startBlock", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("endBlock", "numeric(78, 0)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("traceFilterIntervalsTraceFilterId")
        .on("traceFilterIntervals")
        .column("traceFilterId")
        .execute();

      await db.schema
        .createTable("callTraces")
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("callType", "text", (col) => col.notNull())
        .addColumn("from", "varchar(42)", (col) => col.notNull())
        .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("to", "varchar(42)", (col) => col.notNull())
        .addColumn("value", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("error", "text")
        .addColumn("gasUsed", "numeric(78, 0)")
        .addColumn("output", "text")
        .addColumn("subtraces", "integer", (col) => col.notNull())
        .addColumn("traceAddress", "text", (col) => col.notNull())
        .addColumn("transactionHash", "varchar(66)", (col) => col.notNull())
        .addColumn("transactionPosition", "integer", (col) => col.notNull())
        .addColumn("functionSelector", "varchar(10)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("checkpoint", "varchar(75)", (col) => col.notNull())
        .execute();

      // The callTraces.blockNumber index supports getEvents and deleteRealtimeData
      await db.schema
        .createIndex("callTracesBlockNumberIndex")
        .on("callTraces")
        .column("blockNumber")
        .execute();

      // The callTraces.functionSelector index supports getEvents
      await db.schema
        .createIndex("callTracesFunctionSelectorIndex")
        .on("callTraces")
        .column("functionSelector")
        .execute();

      // The callTraces.error index supports getEvents
      await db.schema
        .createIndex("callTracesErrorIndex")
        .on("callTraces")
        .column("error")
        .execute();

      // The callTraces.blockHash index supports getEvents
      await db.schema
        .createIndex("callTracesBlockHashIndex")
        .on("callTraces")
        .column("blockHash")
        .execute();

      // The callTraces.transactionHash index supports getEvents
      await db.schema
        .createIndex("callTracesTransactionHashIndex")
        .on("callTraces")
        .column("transactionHash")
        .execute();

      // The callTraces.checkpoint index supports getEvents
      await db.schema
        .createIndex("callTracesCheckpointIndex")
        .on("callTraces")
        .column("checkpoint")
        .execute();

      // The callTraces.chainId index supports getEvents
      await db.schema
        .createIndex("callTracesChainIdIndex")
        .on("callTraces")
        .column("chainId")
        .execute();

      // The callTraces.from index supports getEvents
      await db.schema
        .createIndex("callTracesFromIndex")
        .on("callTraces")
        .column("from")
        .execute();

      // The callTraces.to index supports getEvents
      await db.schema
        .createIndex("callTracesToIndex")
        .on("callTraces")
        .column("to")
        .execute();

      await db.schema
        .alterTable("factories")
        .renameTo("factoryLogFilters")
        .execute();

      await db.schema
        .createTable("factoryTraceFilters")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${chainId}_${address}_${eventSelector}_${childAddressLocation}_${fromAddress}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(42)", (col) => col.notNull())
        .addColumn("eventSelector", "varchar(66)", (col) => col.notNull())
        .addColumn("childAddressLocation", "text", (col) => col.notNull()) // `topic${number}` or `offset${number}`
        .addColumn("fromAddress", "varchar(42)")
        .execute();
      await db.schema
        .createTable("factoryTraceFilterIntervals")
        .addColumn("id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryId", "text")
        .addColumn("startBlock", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("endBlock", "numeric(78, 0)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("factoryTraceFilterIntervalsFactoryId")
        .on("factoryTraceFilterIntervals")
        .column("factoryId")
        .execute();
    },
  },
  "2024_11_04_0_request_cache": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("rpc_request_results")
        .addColumn("request", "text", (col) => col.notNull())
        .addColumn("block_number", "numeric(78, 0)")
        .addColumn("chain_id", "integer", (col) => col.notNull())
        .addColumn("result", "text", (col) => col.notNull())
        .addPrimaryKeyConstraint("rpc_request_result_primary_key", [
          "request",
          "chain_id",
        ])
        .execute();

      await db.executeQuery(
        sql`
INSERT INTO ponder_sync.rpc_request_results (request, block_number, chain_id, result)
SELECT 
  CONCAT (
    '{"method":"eth_getbalance","params":["',
    LOWER(SUBSTRING(request, 16)),
    '","0x',
    to_hex("blockNumber"::bigint),
    '"]}'
  ) as request,
  "blockNumber" as block_number,
  "chainId" as chain_id,
  result
FROM ponder_sync."rpcRequestResults"
WHERE ponder_sync."rpcRequestResults".request LIKE 'eth_getBalance_%'
AND ponder_sync."rpcRequestResults"."blockNumber" <= 9223372036854775807;
`.compile(db),
      );

      await db.executeQuery(
        sql`
INSERT INTO ponder_sync.rpc_request_results (request, block_number, chain_id, result)
SELECT 
  CONCAT (
    '{"method":"eth_call","params":[{"data":"',
    LOWER(SUBSTRING(request, 53)),
    '","to":"',
    LOWER(SUBSTRING(request, 10, 42)),
    '"},"0x',
    to_hex("blockNumber"::bigint),
    '"]}'
  ) as request,
  "blockNumber" as block_number,
  "chainId" as chain_id,
  result
FROM ponder_sync."rpcRequestResults"
WHERE ponder_sync."rpcRequestResults".request LIKE 'eth_call_%'
AND ponder_sync."rpcRequestResults"."blockNumber" <= 9223372036854775807;
`.compile(db),
      );

      await db.schema
        .dropTable("rpcRequestResults")
        .ifExists()
        .cascade()
        .execute();
    },
  },
  "2024_11_09_0_adjacent_interval": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("intervals")
        .addColumn("fragment_id", "text", (col) => col.notNull().primaryKey())
        .addColumn("chain_id", "integer", (col) => col.notNull())
        .addColumn("blocks", sql`nummultirange`, (col) => col.notNull())
        .execute();

      await db
        .with("range(fragment_id, chain_id, blocks)", (db) =>
          db
            .selectFrom("logFilters as lf")
            .innerJoin("logFilterIntervals as lfi", "lf.id", "lfi.logFilterId")
            .select([
              sql<string>`concat('log', '_', lf.id)`.as("fragment_id"),
              "lf.chainId as chain_id",
              sql`numrange(lfi."startBlock", lfi."endBlock" + 1, '[]')`.as(
                "blocks",
              ),
            ]),
        )
        .insertInto("intervals")
        .columns(["fragment_id", "chain_id", "blocks"])
        .expression(
          sql.raw(`
SELECT
  fragment_id,
  chain_id,
  range_agg(range.blocks) as blocks
FROM range
GROUP BY fragment_id, chain_id
`),
        )
        .execute();

      await db.schema.dropTable("logFilters").ifExists().cascade().execute();
      await db.schema
        .dropTable("logFilterIntervals")
        .ifExists()
        .cascade()
        .execute();

      await db
        .with("range(fragment_id, chain_id, blocks)", (db) =>
          db
            .selectFrom("factoryLogFilters as flf")
            .innerJoin(
              "factoryLogFilterIntervals as flfi",
              "flf.id",
              "flfi.factoryId",
            )
            .select([
              sql<string>`concat('log', '_', flf.id)`.as("fragment_id"),
              "flf.chainId as chain_id",
              sql`numrange(flfi."startBlock", flfi."endBlock" + 1, '[]')`.as(
                "blocks",
              ),
            ]),
        )
        .insertInto("intervals")
        .columns(["fragment_id", "chain_id", "blocks"])
        .expression(
          sql.raw(`
  SELECT
    fragment_id,
    chain_id,
    range_agg(range.blocks) as blocks
  FROM range
  GROUP BY fragment_id, chain_id
  `),
        )
        .onConflict((oc) =>
          oc.column("fragment_id").doUpdateSet({
            blocks: sql`intervals.blocks + excluded.blocks`,
          }),
        )
        .execute();

      await db.schema
        .dropTable("factoryLogFilters")
        .ifExists()
        .cascade()
        .execute();
      await db.schema
        .dropTable("factoryLogFilterIntervals")
        .ifExists()
        .cascade()
        .execute();

      await db
        .with("range(fragment_id, chain_id, blocks)", (db) =>
          db
            .selectFrom("traceFilters as tf")
            .innerJoin(
              "traceFilterIntervals as tfi",
              "tf.id",
              "tfi.traceFilterId",
            )
            .select([
              sql<string>`concat('trace', '_', tf.id)`.as("fragment_id"),
              "tf.chainId as chain_id",
              sql`numrange(tfi."startBlock", tfi."endBlock" + 1, '[]')`.as(
                "blocks",
              ),
            ]),
        )
        .insertInto("intervals")
        .columns(["fragment_id", "chain_id", "blocks"])
        .expression(
          sql.raw(`
  SELECT
    fragment_id,
    chain_id,
    range_agg(range.blocks) as blocks
  FROM range
  GROUP BY fragment_id, chain_id
  `),
        )
        .onConflict((oc) =>
          oc.column("fragment_id").doUpdateSet({
            blocks: sql`intervals.blocks + excluded.blocks`,
          }),
        )
        .execute();

      await db.schema.dropTable("traceFilters").ifExists().cascade().execute();
      await db.schema
        .dropTable("traceFilterIntervals")
        .ifExists()
        .cascade()
        .execute();

      await db
        .with("range(fragment_id, chain_id, blocks)", (db) =>
          db
            .selectFrom("factoryTraceFilters as ftf")
            .innerJoin(
              "factoryTraceFilterIntervals as ftfi",
              "ftf.id",
              "ftfi.factoryId",
            )
            .select([
              sql<string>`concat('trace', '_', ftf.id)`.as("fragment_id"),
              "ftf.chainId as chain_id",
              sql`numrange(ftfi."startBlock", ftfi."endBlock" + 1, '[]')`.as(
                "blocks",
              ),
            ]),
        )
        .insertInto("intervals")
        .columns(["fragment_id", "chain_id", "blocks"])
        .expression(
          sql.raw(`
  SELECT
    fragment_id,
    chain_id,
    range_agg(range.blocks) as blocks
  FROM range
  GROUP BY fragment_id, chain_id
  `),
        )
        .onConflict((oc) =>
          oc.column("fragment_id").doUpdateSet({
            blocks: sql`intervals.blocks + excluded.blocks`,
          }),
        )
        .execute();

      await db.schema
        .dropTable("factoryTraceFilters")
        .ifExists()
        .cascade()
        .execute();
      await db.schema
        .dropTable("factoryTraceFilterIntervals")
        .ifExists()
        .cascade()
        .execute();

      await db
        .with("range(fragment_id, chain_id, blocks)", (db) =>
          db
            .selectFrom("blockFilters as bf")
            .innerJoin(
              "blockFilterIntervals as bfi",
              "bf.id",
              "bfi.blockFilterId",
            )
            .select([
              sql<string>`concat('block', '_', bf.id)`.as("fragment_id"),
              "bf.chainId as chain_id",
              sql`numrange(bfi."startBlock", bfi."endBlock" + 1, '[]')`.as(
                "blocks",
              ),
            ]),
        )
        .insertInto("intervals")
        .columns(["fragment_id", "chain_id", "blocks"])
        .expression(
          sql.raw(`
  SELECT
    fragment_id,
    chain_id,
    range_agg(range.blocks) as blocks
  FROM range
  GROUP BY fragment_id, chain_id
  `),
        )
        .onConflict((oc) =>
          oc.column("fragment_id").doUpdateSet({
            blocks: sql`intervals.blocks + excluded.blocks`,
          }),
        )
        .execute();

      await db.schema.dropTable("blockFilters").ifExists().cascade().execute();
      await db.schema
        .dropTable("blockFilterIntervals")
        .ifExists()
        .cascade()
        .execute();
    },
  },
  "2024_11_12_0_debug": {
    async up(db) {
      await db.schema.dropTable("callTraces").ifExists().cascade().execute();

      await db
        .deleteFrom("intervals")
        .where("fragment_id", "like", "trace_%")
        .execute();

      await db.schema
        .createTable("traces")
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("checkpoint", "varchar(75)", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("transactionHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("from", "varchar(42)", (col) => col.notNull())
        .addColumn("to", "varchar(42)")
        .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("gasUsed", "numeric(78, 0)", (col) => col.notNull())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("functionSelector", "text", (col) => col.notNull())
        .addColumn("output", "text")
        .addColumn("error", "text")
        .addColumn("revertReason", "text")
        .addColumn("value", "numeric(78, 0)")
        .addColumn("index", "integer", (col) => col.notNull())
        .addColumn("subcalls", "integer", (col) => col.notNull())
        .addColumn("isReverted", "integer", (col) => col.notNull())
        .execute();

      // `getEvents` benefits from an index on
      // "blockNumber", "functionSelector", "blockHash"
      // "transactionHash", "checkpoint", "chainId", "from", "to",
      // "value", "type", and "isReverted"

      await db.schema
        .createIndex("trace_block_number_index")
        .on("traces")
        .column("blockNumber")
        .execute();

      await db.schema
        .createIndex("trace_function_selector_index")
        .on("traces")
        .column("functionSelector")
        .execute();

      await db.schema
        .createIndex("trace_is_reverted_index")
        .on("traces")
        .column("isReverted")
        .execute();

      await db.schema
        .createIndex("trace_block_hash_index")
        .on("traces")
        .column("blockHash")
        .execute();

      await db.schema
        .createIndex("trace_transaction_hash_index")
        .on("traces")
        .column("transactionHash")
        .execute();

      await db.schema
        .createIndex("trace_checkpoint_index")
        .on("traces")
        .column("checkpoint")
        .execute();

      await db.schema
        .createIndex("trace_chain_id_index")
        .on("traces")
        .column("chainId")
        .execute();

      await db.schema
        .createIndex("trace_value_index")
        .on("traces")
        .column("value")
        .execute();

      await db.schema
        .createIndex("trace_from_index")
        .on("traces")
        .column("from")
        .execute();

      await db.schema
        .createIndex("trace_to_index")
        .on("traces")
        .column("to")
        .execute();

      await db.schema
        .createIndex("trace_type_index")
        .on("traces")
        .column("type")
        .execute();

      // add `checkpoint` to `transactions`
      await db.schema
        .alterTable("transactions")
        .addColumn("checkpoint", "varchar(75)")
        .execute();

      await db.schema
        .createIndex("transactions_checkpoint_index")
        .on("transactions")
        .column("checkpoint")
        .execute();

      await db.schema
        .alterTable("transactionReceipts")
        .dropColumn("logs")
        .execute();
    },
  },
  "2024_12_02_0_request_cache": {
    async up(db) {
      await db.schema
        .alterTable("rpc_request_results")
        .addColumn("request_hash", "text", (col) =>
          col.generatedAlwaysAs(sql`MD5(request)`).stored().notNull(),
        )
        .execute();

      // Drop previous primary key constraint, on columns "request" and "chain_id"

      await db.schema
        .alterTable("rpc_request_results")
        .dropConstraint("rpc_request_result_primary_key")
        .execute();

      await db.schema
        .alterTable("rpc_request_results")
        .addPrimaryKeyConstraint("rpc_request_result_primary_key", [
          "request_hash",
          "chain_id",
        ])
        .execute();
    },
  },
  "2025_02_19_0_primary_key": {
    async up(db) {
      // 1. drop unused indexes
      // 2. update column types
      // 3. drop primary key
      // 4. drop unused columns
      // 5. rename tables and columns
      // 6. create new primary key
      // 7. reset metadata

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] started 2025_02_19_0_primary_key`,
      });

      await db.executeQuery(sql`SET statement_timeout = 3600000;`.compile(db));

      await db.schema.dropIndex("logAddressIndex").ifExists().execute();
      await db.schema.dropIndex("logBlockHashIndex").ifExists().execute();
      await db.schema.dropIndex("logBlockNumberIndex").ifExists().execute();
      await db.schema.dropIndex("logChainIdIndex").ifExists().execute();
      await db.schema.dropIndex("logTopic0Index").ifExists().execute();
      await db.schema
        .dropIndex("log_transaction_hash_index")
        .ifExists()
        .execute();
      await db.schema.dropIndex("logs_checkpoint_index").ifExists().execute();
      await db.schema.dropIndex("blockChainIdIndex").execute();
      await db.schema.dropIndex("blockCheckpointIndex").execute();
      await db.schema.dropIndex("blockNumberIndex").execute();
      await db.schema.dropIndex("transactions_checkpoint_index").execute();
      await db.schema.dropIndex("trace_block_hash_index").ifExists().execute();
      await db.schema
        .dropIndex("trace_block_number_index")
        .ifExists()
        .execute();
      await db.schema.dropIndex("trace_chain_id_index").ifExists().execute();
      await db.schema.dropIndex("trace_checkpoint_index").ifExists().execute();
      await db.schema.dropIndex("trace_from_index").ifExists().execute();
      await db.schema
        .dropIndex("trace_function_selector_index")
        .ifExists()
        .execute();
      await db.schema.dropIndex("trace_is_reverted_index").ifExists().execute();
      await db.schema.dropIndex("trace_to_index").ifExists().execute();
      await db.schema
        .dropIndex("trace_transaction_hash_index")
        .ifExists()
        .execute();
      await db.schema.dropIndex("trace_type_index").ifExists().execute();
      await db.schema.dropIndex("trace_value_index").ifExists().execute();

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] dropped indexes`,
      });

      await db.schema
        .alterTable("logs")
        .alterColumn("blockNumber", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("blocks")
        .alterColumn("number", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("blocks")
        .alterColumn("timestamp", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("transactions")
        .alterColumn("blockNumber", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("transactionReceipts")
        .alterColumn("blockNumber", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("transactionReceipts")
        .alterColumn("chainId", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("traces")
        .alterColumn("blockNumber", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("traces")
        .alterColumn("chainId", (qb) => qb.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("traces")
        .addColumn("transaction_index", "integer")
        .execute();
      await db
        .updateTable("traces")
        .set({ transaction_index: sql`SUBSTRING(checkpoint, 43, 16)::bigint` })
        .execute();
      await db.schema
        .alterTable("traces")
        .alterColumn("transaction_index", (col) => col.setNotNull())
        .execute();
      await db.schema
        .alterTable("intervals")
        .alterColumn("chain_id", (qb) => qb.setDataType("bigint"))
        .execute();

      await db.deleteFrom("logs").where("checkpoint", "=", null).execute();

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] updated column types`,
      });

      await db.schema.alterTable("logs").dropConstraint("logs_pkey").execute();
      await db.schema
        .alterTable("blocks")
        .dropConstraint("blocks_pkey")
        .execute();
      await db.schema
        .alterTable("transactions")
        .dropConstraint("transactions_pkey")
        .execute();
      await db.schema
        .alterTable("transactionReceipts")
        .dropConstraint("transactionReceipts_pkey")
        .execute();
      await db.schema
        .alterTable("traces")
        .dropConstraint("traces_pkey")
        .execute();

      await db.schema.alterTable("logs").dropColumn("checkpoint").execute();
      await db.schema.alterTable("logs").dropColumn("id").execute();
      await db.schema.alterTable("blocks").dropColumn("checkpoint").execute();
      await db.schema
        .alterTable("transactions")
        .dropColumn("checkpoint")
        .execute();
      await db.schema.alterTable("traces").dropColumn("id").execute();
      await db.schema.alterTable("traces").dropColumn("checkpoint").execute();
      await db.schema
        .alterTable("traces")
        .dropColumn("transactionHash")
        .execute();
      await db.schema.alterTable("traces").dropColumn("blockHash").execute();
      await db.schema
        .alterTable("traces")
        .dropColumn("functionSelector")
        .execute();
      await db.schema.alterTable("traces").dropColumn("isReverted").execute();

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] dropped columns`,
      });

      await db.schema
        .alterTable("logs")
        .renameColumn("chainId", "chain_id")
        .execute();
      await db.schema
        .alterTable("logs")
        .renameColumn("blockNumber", "block_number")
        .execute();
      await db.schema
        .alterTable("logs")
        .renameColumn("logIndex", "log_index")
        .execute();
      await db.schema
        .alterTable("logs")
        .renameColumn("transactionIndex", "transaction_index")
        .execute();
      await db.schema
        .alterTable("logs")
        .renameColumn("blockHash", "block_hash")
        .execute();
      await db.schema
        .alterTable("logs")
        .renameColumn("transactionHash", "transaction_hash")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("chainId", "chain_id")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("parentHash", "parent_hash")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("logsBloom", "logs_bloom")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("gasUsed", "gas_used")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("gasLimit", "gas_limit")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("baseFeePerGas", "base_fee_per_gas")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("mixHash", "mix_hash")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("stateRoot", "state_root")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("receiptsRoot", "receipts_root")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("transactionsRoot", "transactions_root")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("sha3Uncles", "sha3_uncles")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("totalDifficulty", "total_difficulty")
        .execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("extraData", "extra_data")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("chainId", "chain_id")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("blockNumber", "block_number")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("transactionIndex", "transaction_index")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("blockHash", "block_hash")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("gasPrice", "gas_price")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("maxFeePerGas", "max_fee_per_gas")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("maxPriorityFeePerGas", "max_priority_fee_per_gas")
        .execute();
      await db.schema
        .alterTable("transactions")
        .renameColumn("accessList", "access_list")
        .execute();
      await db.schema
        .alterTable("transactionReceipts")
        .renameTo("transaction_receipts")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("chainId", "chain_id")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("blockNumber", "block_number")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("transactionIndex", "transaction_index")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("blockHash", "block_hash")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("transactionHash", "transaction_hash")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("contractAddress", "contract_address")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("logsBloom", "logs_bloom")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("gasUsed", "gas_used")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("cumulativeGasUsed", "cumulative_gas_used")
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .renameColumn("effectiveGasPrice", "effective_gas_price")
        .execute();
      await db.schema
        .alterTable("traces")
        .renameColumn("chainId", "chain_id")
        .execute();
      await db.schema
        .alterTable("traces")
        .renameColumn("blockNumber", "block_number")
        .execute();
      await db.schema
        .alterTable("traces")
        .renameColumn("index", "trace_index")
        .execute();
      await db.schema
        .alterTable("traces")
        .renameColumn("gasUsed", "gas_used")
        .execute();
      await db.schema
        .alterTable("traces")
        .renameColumn("revertReason", "revert_reason")
        .execute();

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] renamed columns`,
      });

      await db.schema
        .alterTable("logs")
        .addPrimaryKeyConstraint("logs_pkey", [
          "chain_id",
          "block_number",
          "log_index",
        ])
        .execute();
      await db.schema
        .alterTable("blocks")
        .addPrimaryKeyConstraint("blocks_pkey", ["chain_id", "number"])
        .execute();
      await db.schema
        .alterTable("transactions")
        .addPrimaryKeyConstraint("transactions_pkey", [
          "chain_id",
          "block_number",
          "transaction_index",
        ])
        .execute();
      await db.schema
        .alterTable("transaction_receipts")
        .addPrimaryKeyConstraint("transaction_receipts_pkey", [
          "chain_id",
          "block_number",
          "transaction_index",
        ])
        .execute();
      await db.schema
        .alterTable("traces")
        .addPrimaryKeyConstraint("traces_pkey", [
          "chain_id",
          "block_number",
          "transaction_index",
          "trace_index",
        ])
        .execute();

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] added primary keys`,
      });

      await sql`ANALYZE ponder_sync.logs`.execute(db);
      await sql`ANALYZE ponder_sync.blocks`.execute(db);
      await sql`ANALYZE ponder_sync.transactions`.execute(db);
      await sql`ANALYZE ponder_sync.transaction_receipts`.execute(db);
      await sql`ANALYZE ponder_sync.traces`.execute(db);

      await sql`REINDEX TABLE ponder_sync.logs`.execute(db);
      await sql`REINDEX TABLE ponder_sync.blocks`.execute(db);
      await sql`REINDEX TABLE ponder_sync.transactions`.execute(db);
      await sql`REINDEX TABLE ponder_sync.transaction_receipts`.execute(db);
      await sql`REINDEX TABLE ponder_sync.traces`.execute(db);

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] finished 2025_02_19_0_primary_key`,
      });
    },
  },
  "2025_02_26_0_factories": {
    async up(db) {
      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] started 2025_02_26_0_factories`,
      });
      await db.executeQuery(sql`SET statement_timeout = 3600000;`.compile(db));

      // drop any intervals that contain a factory address
      await db
        .deleteFrom("intervals")
        .where((qb) =>
          qb.or([
            qb("fragment_id", "like", "%offset%"),
            qb("fragment_id", "like", "%topic%"),
          ]),
        )
        .execute();

      await db.schema
        .createTable("factories")
        .addColumn("id", "integer", (col) =>
          col.generatedAlwaysAsIdentity().primaryKey(),
        )
        .addColumn("factory", "jsonb", (col) => col.notNull().unique())
        .execute();

      await db.schema
        .createTable("factory_addresses")
        .addColumn("id", "integer", (col) =>
          col.generatedAlwaysAsIdentity().primaryKey(),
        )
        .addColumn("factory_id", "integer", (col) => col.notNull())
        .addColumn("chain_id", "bigint", (col) => col.notNull())
        .addColumn("block_number", "bigint", (col) => col.notNull())
        .addColumn("address", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createIndex("factories_factory_index")
        .on("factories")
        .column("factory")
        .execute();

      await db.schema
        .createIndex("factory_addresses_factory_id_index")
        .on("factory_addresses")
        .column("factory_id")
        .execute();

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] finished 2025_02_26_0_factories`,
      });
    },
  },
  "2025_02_26_1_rpc_request_results": {
    async up(db) {
      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] started 2025_02_26_1_rpc_request_results`,
      });
      await db.executeQuery(sql`SET statement_timeout = 3600000;`.compile(db));

      await db.schema
        .alterTable("rpc_request_results")
        .addColumn("request_hash_temp", "text")
        .execute();
      await db
        .updateTable("rpc_request_results")
        .set({ request_hash_temp: sql`request_hash` })
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .dropConstraint("rpc_request_result_primary_key")
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .dropColumn("request_hash")
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .renameColumn("request_hash_temp", "request_hash")
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .addPrimaryKeyConstraint("rpc_request_results_pkey", [
          "chain_id",
          "request_hash",
        ])
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .dropColumn("request")
        .execute();
      await db
        .updateTable("rpc_request_results")
        .set({ block_number: 0 })
        .where("block_number", "=", maxUint256)
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .alterColumn("block_number", (col) => col.setDataType("bigint"))
        .execute();
      await db.schema
        .alterTable("rpc_request_results")
        .alterColumn("chain_id", (col) => col.setDataType("bigint"))
        .execute();
      await db.schema
        .createIndex("rpc_request_results_chain_id_block_number_index")
        .on("rpc_request_results")
        .columns(["chain_id", "block_number"])
        .execute();
      await db
        .deleteFrom("rpc_request_results")
        .where("result", "=", "0x")
        .execute();
      await sql`ANALYZE ponder_sync.rpc_request_results`.execute(db);

      logger.debug({
        service: "migrate",
        msg: `${new Date().toISOString()} [ponder_sync migration] finished 2025_02_26_1_rpc_request_results`,
      });
    },
  },
};
