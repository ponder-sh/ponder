import type { Common } from "@/internal/common.js";
import type { Kysely, Migration, MigrationProvider } from "kysely";
import { sql } from "kysely";
import type { Hex } from "viem";

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();

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
  "2025_01_08_0_factory_redesign": {
    async up(db) {
      // Data migration to move factory logs from `logs` to `factory`
      // and `factory_address` tables
      const fragmentRows = await db
        .selectFrom("intervals")
        .select(["fragment_id", "chain_id"])
        .execute();

      const factoryIdMap = new Map<number, Set<string>>();

      for (const row of fragmentRows) {
        const chainId = row.chain_id as number;
        const fragmentId = row.fragment_id as string;
        // Find all occurrences of _offset and _topic in the fragment ID
        const matches = [...fragmentId.matchAll(/_(?:offset|topic)([^_]*)/g)];

        // For each match, extract the preceding 110 characters to get the factory ID
        for (const match of matches) {
          const factoryId = fragmentId.substring(
            Math.max(0, match.index! - 109),
            match.index! + match[0].length,
          );

          if (!factoryIdMap.has(chainId)) factoryIdMap.set(chainId, new Set());
          factoryIdMap.get(chainId)!.add(factoryId);
        }
      }

      for (const [chainId, factoryIdSet] of factoryIdMap) {
        // Create factory table
        await db.schema
          .createTable(`factory_${chainId}`)
          .addColumn("integer_id", "integer", (col) =>
            col.primaryKey().generatedAlwaysAsIdentity(),
          )
          .addColumn("factory_id", "text", (col) => col.notNull().unique())
          .execute();

        // Create factory_address table
        await db.schema
          .createTable(`factory_address_${chainId}`)
          .addColumn("id", "integer", (col) =>
            col.primaryKey().generatedAlwaysAsIdentity(),
          )
          .addColumn("factory_integer_id", "integer", (col) => col.notNull())
          .addColumn("address", "text", (col) => col.notNull())
          .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
          .execute();
        await db.schema
          .createIndex(`factory_address_${chainId}_factory_integer_id_index`)
          .on(`factory_address_${chainId}`)
          .columns(["factory_integer_id", "address"])
          .execute();

        // 2) Copy factory logs from the `logs` table into `factory_address`
        // Also write any required factory IDs into `factory` table
        for (const factoryId of [...factoryIdSet]) {
          const [address, eventSelector, childAddressLocation] =
            factoryId.split("_");
          if (
            typeof address !== "string" ||
            address.length !== 42 ||
            typeof eventSelector !== "string" ||
            eventSelector.length !== 66 ||
            typeof childAddressLocation !== "string" ||
            !(
              childAddressLocation.startsWith("offset") ||
              childAddressLocation.startsWith("topic")
            )
          ) {
            console.warn(
              `Migration warning: Invalid factory ID, skipping it (${factoryId})`,
            );
            continue;
          }

          await db
            .with("factory_insert", (db) =>
              db
                .insertInto(`factory_${chainId}`)
                .values({ factory_id: factoryId })
                .onConflict((oc) =>
                  oc
                    .column("factory_id")
                    .doUpdateSet({ factory_id: factoryId }),
                )
                .returning("integer_id"),
            )
            .insertInto(`factory_address_${chainId}`)
            .columns(["factory_integer_id", "address", "block_number"])
            .expression((db) =>
              db
                .selectFrom(`log_${chainId}`)
                .select([
                  sql`(SELECT integer_id FROM factory_insert)`.as(
                    "factory_integer_id",
                  ),
                  (() => {
                    if (childAddressLocation.startsWith("offset")) {
                      const childAddressOffset = Number(
                        childAddressLocation.substring(6),
                      );
                      const start = 2 + 12 * 2 + childAddressOffset * 2 + 1;
                      const length = 20 * 2;
                      return sql<Hex>`'0x' || substring(data from ${start}::int for ${length}::int)`;
                    } else {
                      const start = 2 + 12 * 2 + 1;
                      const length = 20 * 2;
                      return sql<Hex>`'0x' || substring(${sql.ref(
                        childAddressLocation,
                      )} from ${start}::integer for ${length}::integer)`;
                    }
                  })().as("address"),
                  "blockNumber as block_number",
                ])
                .where("address", "=", address)
                .where("topic0", "=", eventSelector),
            )
            .execute();
        }
      }

      // 3) Delete any log rows that are missing a checkpoint and make it not null
      // Any factory logs that had a checkpoint added after the fact will remain,
      // but won't cause any issues.
      await db.deleteFrom("logs").where("checkpoint", "is", null).execute();
      await db.schema
        .alterTable("logs")
        .alterColumn("checkpoint", (col) => col.setNotNull())
        .execute();
    },
  },
  "2025_01_03_1_transaction_checkpoint_backfill": {
    async up(db) {
      const transactionHashesMissingCheckpoint = await db
        .selectFrom("transactions")
        .select(["hash"]) // we'll use this in our whereIn below
        .where("checkpoint", "is", null)
        .execute()
        .then((rows) => rows.map((row) => row.hash));

      console.log(
        `Migration: Found ${transactionHashesMissingCheckpoint.length} transaction rows without checkpoint, backfilling`,
      );

      // 2. Do the UPDATE in a chunk
      await db
        .updateTable("transactions")
        // join blocks to get the block data
        .from("blocks")
        .whereRef("transactions.blockNumber", "=", "blocks.number")
        // only update the specific rows we selected in this chunk
        .where("transactions.hash", "in", transactionHashesMissingCheckpoint)
        .set({
          checkpoint: sql`(
            lpad(blocks.timestamp::text, 10, '0') ||
            lpad(blocks."chainId"::text, 16, '0') ||
            lpad(blocks.number::text, 16, '0') ||
            lpad(transactions."transactionIndex"::text, 16, '0') ||
            '2' ||
            '0000000000000000'
          )`,
        })
        .execute();

      // If there are any transactions still without a checkpoint, delete and return them
      const rows = await db
        .deleteFrom("transactions")
        .where("checkpoint", "is", null)
        .returning(["hash", "blockNumber"])
        .execute();
      if (rows.length > 0) {
        console.warn(
          `Migration warning: ${rows.length} transaction rows still missing a checkpoint, deleting them`,
        );
      }

      // Set the checkpoint column to not null
      await db.schema
        .alterTable("transactions")
        .alterColumn("checkpoint", (col) => col.setNotNull())
        .execute();
    },
  },
  "2025_01_08_1_add_transaction_index_to_traces": {
    async up(db) {
      // Add `transactionIndex` column to `traces`
      await db.schema
        .alterTable("traces")
        .addColumn("transactionIndex", "integer")
        .execute();
      await db
        .updateTable("traces")
        .from("transactions")
        .set((eb: any) => ({
          transactionIndex: eb.ref("transactions.transactionIndex"),
        }))
        .whereRef("traces.transactionHash", "=", "transactions.hash")
        .execute();
      await db.schema
        .alterTable("traces")
        .alterColumn("transactionIndex", (ac) => ac.setNotNull())
        .execute();
    },
  },
  "2025_01_05_1_chain_specific_tables": {
    async up(db) {
      /// BLOCKS ///

      // Get distinct chain IDs from blocks table
      const blockChainIds = await db
        .selectFrom("blocks")
        .select("chainId")
        .distinct()
        .execute()
        .then((rows) => rows.map((row) => row.chainId));

      for (const chainId of blockChainIds) {
        await db.schema
          .createTable(`block_${chainId}`)
          // ID columns
          .addColumn("checkpoint", "varchar(75)", (col) =>
            col.notNull().primaryKey(),
          )
          .addColumn("number", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("hash", "varchar(66)", (col) => col.notNull())
          .addColumn("parent_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("timestamp", "numeric(78, 0)", (col) => col.notNull())
          // Extra columns
          .addColumn("base_fee_per_gas", "numeric(78, 0)")
          .addColumn("difficulty", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("extra_data", "text", (col) => col.notNull())
          .addColumn("gas_limit", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("logs_bloom", "varchar(514)", (col) => col.notNull())
          .addColumn("miner", "varchar(42)", (col) => col.notNull())
          .addColumn("mix_hash", "varchar(66)")
          .addColumn("nonce", "varchar(18)")
          .addColumn("receipts_root", "varchar(66)", (col) => col.notNull())
          .addColumn("sha3_uncles", "varchar(66)")
          .addColumn("size", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("state_root", "varchar(66)", (col) => col.notNull())
          .addColumn("total_difficulty", "numeric(78, 0)")
          .addColumn("transactions_root", "varchar(66)", (col) => col.notNull())
          .execute();

        // Move data from old table to new chain-specific table
        await db
          .with("moved_blocks", (db) =>
            db
              .deleteFrom("blocks")
              .where("chainId", "=", chainId)
              .returningAll(),
          )
          .insertInto(`block_${chainId}`)
          .columns([
            "checkpoint",
            "number",
            "hash",
            "parent_hash",
            "timestamp",
            "base_fee_per_gas",
            "difficulty",
            "extra_data",
            "gas_limit",
            "gas_used",
            "logs_bloom",
            "miner",
            "mix_hash",
            "nonce",
            "receipts_root",
            "sha3_uncles",
            "size",
            "state_root",
            "total_difficulty",
            "transactions_root",
          ])
          .expression(
            db
              .selectFrom("moved_blocks")
              .select([
                "checkpoint",
                "number",
                "hash",
                "parent_hash",
                "timestamp",
                "base_fee_per_gas",
                "difficulty",
                "extra_data",
                "gas_limit",
                "gas_used",
                "logs_bloom",
                "miner",
                "mix_hash",
                "nonce",
                "receipts_root",
                "sha3_uncles",
                "size",
                "state_root",
                "total_difficulty",
                "transactions_root",
              ]),
          )
          .execute();

        // Create indexes on new table
        await db.schema
          .createIndex(`block_${chainId}_ordering_index`)
          .on(`block_${chainId}`)
          .columns(["number asc"])
          .execute();
        await db.schema
          .createIndex(`block_${chainId}_hash_index`)
          .on(`block_${chainId}`)
          .columns(["hash asc"])
          .execute();
      }

      // Drop old blocks table
      await db.schema.dropTable("blocks").execute();

      /// LOGS ///

      // Get distinct chain IDs from logs table
      const chainIds = await db
        .selectFrom("logs")
        .select("chainId")
        .distinct()
        .execute()
        .then((rows) => rows.map((row) => row.chainId));

      for (const chainId of chainIds) {
        await db.schema
          .createTable(`log_${chainId}`)
          // ID columns
          .addColumn("checkpoint", "varchar(75)", (col) =>
            col.notNull().primaryKey(),
          )
          .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("transaction_index", "integer", (col) => col.notNull())
          .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("log_index", "integer", (col) => col.notNull())
          // Filter columns
          .addColumn("address", "varchar(42)", (col) => col.notNull())
          .addColumn("data", "text", (col) => col.notNull())
          .addColumn("topic0", "varchar(66)")
          .addColumn("topic1", "varchar(66)")
          .addColumn("topic2", "varchar(66)")
          .addColumn("topic3", "varchar(66)")
          .execute();

        // Move data from logs table to new chain-specific table
        await db
          .with("moved_logs", (db) =>
            db.deleteFrom("logs").where("chainId", "=", chainId).returningAll(),
          )
          .insertInto(`log_${chainId}`)
          .columns([
            "checkpoint",
            "block_number",
            "block_hash",
            "transaction_index",
            "transaction_hash",
            "log_index",
            "address",
            "data",
            "topic0",
            "topic1",
            "topic2",
            "topic3",
          ])
          .expression(
            db
              .selectFrom("moved_logs")
              .select([
                "checkpoint",
                "blockNumber",
                "blockHash",
                "transactionIndex",
                "transactionHash",
                "logIndex",
                "address",
                "data",
                "topic0",
                "topic1",
                "topic2",
                "topic3",
              ]),
          )
          .execute();

        // Create indexes on new logs table
        await db.schema
          .createIndex(`log_${chainId}_ordering_index`)
          .on(`log_${chainId}`)
          .columns(["block_number asc", "transaction_index asc"])
          .execute();
        await db.schema
          .createIndex(`log_${chainId}_topic0_index`)
          .on(`log_${chainId}`)
          .columns(["topic0 asc", "checkpoint asc"])
          .execute();
        await db.schema
          .createIndex(`log_${chainId}_address_index`)
          .on(`log_${chainId}`)
          .columns(["address asc", "checkpoint asc"])
          .execute();
      }

      // Drop old blocks table
      await db.schema.dropTable("blocks").execute();

      /// TRANSACTIONS ///

      // Get distinct chain IDs from transactions table
      const transactionChainIds = await db
        .selectFrom("transactions")
        .select("chainId")
        .distinct()
        .execute()
        .then((rows) => rows.map((row) => row.chainId));

      for (const chainId of transactionChainIds) {
        await db.schema
          .createTable(`transaction_${chainId}`)
          // ID columns
          .addColumn("checkpoint", "varchar(75)", (col) =>
            col.notNull().primaryKey(),
          )
          .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("transaction_index", "integer", (col) => col.notNull())
          .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
          // Filter columns
          .addColumn("from", "varchar(42)", (col) => col.notNull())
          .addColumn("to", "varchar(42)", (col) => col.notNull())
          // Extra columns
          .addColumn("type", "text", (col) => col.notNull())
          .addColumn("value", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("input", "text", (col) => col.notNull())
          .addColumn("nonce", "integer", (col) => col.notNull())
          .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("gas_price", "numeric(78, 0)")
          .addColumn("max_fee_per_gas", "numeric(78, 0)")
          .addColumn("max_priority_fee_per_gas", "numeric(78, 0)")
          .addColumn("access_list", "text")
          .addColumn("r", "varchar(66)")
          .addColumn("s", "varchar(66)")
          .addColumn("v", "numeric(78, 0)")
          .execute();

        // Move data from old table to new chain-specific table
        await db
          .with("moved_transactions", (db) =>
            db
              .deleteFrom("transactions")
              .where("chainId", "=", chainId)
              .returningAll(),
          )
          .insertInto(`transaction_${chainId}`)
          .columns([
            "checkpoint",
            "block_number",
            "block_hash",
            "transaction_index",
            "hash",
            "from",
            "to",
            "type",
            "value",
            "input",
            "nonce",
            "gas",
            "gas_price",
            "max_fee_per_gas",
            "max_priority_fee_per_gas",
            "access_list",
            "r",
            "s",
            "v",
          ])
          .expression(
            db
              .selectFrom("moved_blocks")
              .select([
                "checkpoint",
                "blockNumber",
                "blockHash",
                "transactionIndex",
                "hash",
                "from",
                "to",
                "type",
                "value",
                "input",
                "nonce",
                "gas",
                "gasPrice",
                "maxFeePerGas",
                "maxPriorityFeePerGas",
                "accessList",
                "r",
                "s",
                "v",
              ]),
          )
          .execute();

        await db.schema
          .createIndex(`transaction_${chainId}_hash_index`)
          .on(`transaction_${chainId}`)
          .columns(["hash asc"])
          .execute();
        await db.schema
          .createIndex(`transaction_${chainId}_ordering_index`)
          .on(`transaction_${chainId}`)
          .columns(["block_number asc", "transaction_index asc"])
          .execute();
        await db.schema
          .createIndex(`transaction_${chainId}_hash_index`)
          .on(`transaction_${chainId}`)
          .columns(["hash asc"])
          .execute();
        await db.schema
          .createIndex(`transaction_${chainId}_from_index`)
          .on(`transaction_${chainId}`)
          .columns(["from asc", "checkpoint asc"])
          .execute();
        await db.schema
          .createIndex(`transaction_${chainId}_to_index`)
          .on(`transaction_${chainId}`)
          .columns(["to asc", "checkpoint asc"])
          .execute();
      }

      // Drop old transactions table
      await db.schema.dropTable("transactions").execute();

      /// TRANSACTION RECEIPTS ///

      // Get distinct chain IDs from transactionReceipts table
      const transactionReceiptChainIds = await db
        .selectFrom("transactionReceipts")
        .select("chainId")
        .distinct()
        .execute()
        .then((rows) => rows.map((row) => row.chainId));

      for (const chainId of transactionReceiptChainIds) {
        await db.schema
          .createTable(`transaction_receipt_${chainId}`)
          // ID columns
          .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("transaction_index", "integer", (col) => col.notNull())
          .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
          // Extra columns
          .addColumn("from", "varchar(42)", (col) => col.notNull())
          .addColumn("to", "varchar(42)")
          .addColumn("contract_address", "varchar(66)")
          .addColumn("status", "text", (col) => col.notNull())
          .addColumn("type", "text", (col) => col.notNull())
          .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("cumulative_gas_used", "numeric(78, 0)", (col) =>
            col.notNull(),
          )
          .addColumn("effective_gas_price", "numeric(78, 0)", (col) =>
            col.notNull(),
          )
          .addColumn("logs_bloom", "varchar(514)", (col) => col.notNull())
          .addPrimaryKeyConstraint(`transaction_receipt_${chainId}_pkey`, [
            "block_number",
            "transaction_index",
          ])
          .execute();

        // Move data from old table to new chain-specific table
        await db
          .with("moved_receipts", (db) =>
            db
              .deleteFrom("transactionReceipts")
              .where("chainId", "=", chainId)
              .returningAll(),
          )
          .insertInto(`transaction_receipt_${chainId}`)
          .columns([
            "block_number",
            "block_hash",
            "transaction_index",
            "transaction_hash",
            "from",
            "to",
            "contract_address",
            "status",
            "type",
            "gas_used",
            "cumulative_gas_used",
            "effective_gas_price",
            "logs_bloom",
          ])
          .expression(
            db
              .selectFrom("moved_receipts")
              .select([
                "blockNumber",
                "blockHash",
                "transactionIndex",
                "transactionHash",
                "from",
                "to",
                "contractAddress",
                "status",
                "type",
                "gasUsed",
                "cumulativeGasUsed",
                "effectiveGasPrice",
                "logsBloom",
              ]),
          )
          .execute();

        await db.schema
          .createIndex(`transaction_receipt_${chainId}_hash_index`)
          .on(`transaction_receipt_${chainId}`)
          .columns(["transaction_hash asc"])
          .execute();
      }

      // Drop old transactionReceipts table
      await db.schema.dropTable("transactionReceipts").execute();

      /// TRACES ///

      // Get distinct chain IDs from traces table
      const traceChainIds = await db
        .selectFrom("traces")
        .select("chainId")
        .distinct()
        .execute()
        .then((rows) => rows.map((row) => row.chainId));

      for (const chainId of traceChainIds) {
        await db.schema
          .createTable(`trace_${chainId}`)
          // ID columns
          .addColumn("checkpoint", "varchar(75)", (col) =>
            col.notNull().primaryKey(),
          )
          .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("transaction_index", "integer", (col) => col.notNull())
          .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
          .addColumn("trace_index", "integer", (col) => col.notNull())
          // Filter columns
          .addColumn("from", "varchar(42)", (col) => col.notNull())
          .addColumn("to", "varchar(42)")
          .addColumn("value", "numeric(78, 0)")
          .addColumn("type", "text", (col) => col.notNull())
          .addColumn("function_selector", "text", (col) => col.notNull())
          .addColumn("is_reverted", "integer", (col) => col.notNull())
          // Extra columns
          .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
          .addColumn("input", "text", (col) => col.notNull())
          .addColumn("output", "text")
          .addColumn("error", "text")
          .addColumn("revert_reason", "text")
          .addColumn("subcalls", "integer", (col) => col.notNull())
          .execute();

        // Move data from old table to new chain-specific table
        await db
          .with("moved_traces", (db) =>
            db
              .deleteFrom("traces")
              .where("chainId", "=", chainId)
              .returningAll(),
          )
          .insertInto(`trace_${chainId}`)
          .columns([
            "checkpoint",
            "block_number",
            "block_hash",
            "transaction_index",
            "transaction_hash",
            "trace_index",
            "type",
            "from",
            "to",
            "value",
            "function_selector",
            "is_reverted",
            "gas",
            "gas_used",
            "input",
            "output",
            "error",
            "revert_reason",
            "subcalls",
          ])
          .expression(
            db
              .selectFrom("moved_traces")
              .select([
                "checkpoint",
                "blockNumber",
                "blockHash",
                "transactionIndex",
                "transactionHash",
                "index",
                "type",
                "from",
                "to",
                "value",
                "functionSelector",
                "isReverted",
                "gas",
                "gasUsed",
                "input",
                "output",
                "error",
                "revertReason",
                "subcalls",
              ]),
          )
          .execute();

        // Create indexes on new table
        await db.schema
          .createIndex(`trace_${chainId}_ordering_index`)
          .on(`trace_${chainId}`)
          .columns(["block_number asc", "transaction_index asc"])
          .execute();
        await db.schema
          .createIndex(`trace_${chainId}_from_index`)
          .on(`trace_${chainId}`)
          .columns(["from asc", "checkpoint asc"])
          .execute();
        await db.schema
          .createIndex(`trace_${chainId}_to_index`)
          .on(`trace_${chainId}`)
          .columns(["to asc", "checkpoint asc"])
          .execute();
      }

      // Drop old traces table
      await db.schema.dropTable("traces").execute();

      /// RPC REQUESTS ///

      // Get distinct chain IDs from rpc_request_results table
      const rpcRequestChainIds = await db
        .selectFrom("rpc_request_results")
        .select("chain_id")
        .distinct()
        .execute()
        .then((rows) => rows.map((row) => row.chain_id));

      for (const chainId of rpcRequestChainIds) {
        await db.schema
          .createTable(`rpc_request_${chainId}`)
          .addColumn("request_hash", "text", (col) =>
            col
              .generatedAlwaysAs(sql`MD5(request)`)
              .stored()
              .notNull()
              .primaryKey(),
          )
          .addColumn("request", "text", (col) => col.notNull())
          .addColumn("result", "text", (col) => col.notNull())
          .addColumn("block_number", "numeric(78, 0)")
          .execute();

        // Move data from old table to new chain-specific table
        await db
          .with("moved_rpc_requests", (db) =>
            db
              .deleteFrom("rpc_request_results")
              .where("chain_id", "=", chainId)
              .returningAll(),
          )
          .insertInto(`rpc_request_${chainId}`)
          .columns(["request_hash", "request", "result", "block_number"])
          .expression(
            db
              .selectFrom("moved_rpc_requests")
              .select(["request_hash", "request", "result", "block_number"]),
          )
          .execute();
      }

      // Drop old rpc_request_results table
      await db.schema.dropTable("rpc_request_results").execute();
    },
  },
};

export async function createTablesForChainId(db: Kysely<any>, chainId: number) {
  // factory
  await db.schema
    .createTable(`factory_${chainId}`)
    .ifNotExists()
    .addColumn("integer_id", "integer", (col) =>
      col.primaryKey().generatedAlwaysAsIdentity(),
    )
    .addColumn("factory_id", "text", (col) => col.notNull().unique())
    .execute();

  // factory_address
  await db.schema
    .createTable(`factory_address_${chainId}`)
    .ifNotExists()
    .addColumn("id", "integer", (col) =>
      col.primaryKey().generatedAlwaysAsIdentity(),
    )
    .addColumn("factory_integer_id", "integer", (col) => col.notNull())
    .addColumn("address", "text", (col) => col.notNull())
    .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex(`factory_address_${chainId}_factory_integer_id_index`)
    .ifNotExists()
    .on(`factory_address_${chainId}`)
    .columns(["factory_integer_id", "address"])
    .execute();

  // block
  await db.schema
    .createTable(`block_${chainId}`)
    .ifNotExists()
    // ID columns
    .addColumn("checkpoint", "varchar(75)", (col) => col.notNull().primaryKey())
    .addColumn("number", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("hash", "varchar(66)", (col) => col.notNull())
    .addColumn("parent_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("timestamp", "numeric(78, 0)", (col) => col.notNull())
    // Extra columns
    .addColumn("base_fee_per_gas", "numeric(78, 0)")
    .addColumn("difficulty", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("extra_data", "text", (col) => col.notNull())
    .addColumn("gas_limit", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("logs_bloom", "varchar(514)", (col) => col.notNull())
    .addColumn("miner", "varchar(42)", (col) => col.notNull())
    .addColumn("mix_hash", "varchar(66)")
    .addColumn("nonce", "varchar(18)")
    .addColumn("receipts_root", "varchar(66)", (col) => col.notNull())
    .addColumn("sha3_uncles", "varchar(66)")
    .addColumn("size", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("state_root", "varchar(66)", (col) => col.notNull())
    .addColumn("total_difficulty", "numeric(78, 0)")
    .addColumn("transactions_root", "varchar(66)", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex(`block_${chainId}_ordering_index`)
    .ifNotExists()
    .on(`block_${chainId}`)
    .columns(["number asc"])
    .execute();
  await db.schema
    .createIndex(`block_${chainId}_hash_index`)
    .ifNotExists()
    .on(`block_${chainId}`)
    .columns(["hash asc"])
    .execute();

  // log
  await db.schema
    .createTable(`log_${chainId}`)
    .ifNotExists()
    // ID columns
    .addColumn("checkpoint", "varchar(75)", (col) => col.notNull().primaryKey())
    .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("transaction_index", "integer", (col) => col.notNull())
    .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("log_index", "integer", (col) => col.notNull())
    // Filter columns
    .addColumn("address", "varchar(42)", (col) => col.notNull())
    .addColumn("data", "text", (col) => col.notNull())
    .addColumn("topic0", "varchar(66)")
    .addColumn("topic1", "varchar(66)")
    .addColumn("topic2", "varchar(66)")
    .addColumn("topic3", "varchar(66)")
    .execute();
  await db.schema
    .createIndex(`log_${chainId}_ordering_index`)
    .ifNotExists()
    .on(`log_${chainId}`)
    .columns(["block_number asc", "transaction_index asc"])
    .execute();
  await db.schema
    .createIndex(`log_${chainId}_topic0_index`)
    .ifNotExists()
    .on(`log_${chainId}`)
    .columns(["topic0 asc", "checkpoint asc"])
    .execute();
  await db.schema
    .createIndex(`log_${chainId}_address_index`)
    .ifNotExists()
    .on(`log_${chainId}`)
    .columns(["address asc", "checkpoint asc"])
    .execute();

  // transaction
  await db.schema
    .createTable(`transaction_${chainId}`)
    .ifNotExists()
    // ID columns
    .addColumn("checkpoint", "varchar(75)", (col) => col.notNull().primaryKey())
    .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("transaction_index", "integer", (col) => col.notNull())
    .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
    // Filter columns
    .addColumn("from", "varchar(42)", (col) => col.notNull())
    .addColumn("to", "varchar(42)", (col) => col.notNull())
    // Extra columns
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("value", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("input", "text", (col) => col.notNull())
    .addColumn("nonce", "integer", (col) => col.notNull())
    .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("gas_price", "numeric(78, 0)")
    .addColumn("max_fee_per_gas", "numeric(78, 0)")
    .addColumn("max_priority_fee_per_gas", "numeric(78, 0)")
    .addColumn("access_list", "text")
    .addColumn("r", "varchar(66)")
    .addColumn("s", "varchar(66)")
    .addColumn("v", "numeric(78, 0)")
    .execute();
  await db.schema
    .createIndex(`transaction_${chainId}_ordering_index`)
    .ifNotExists()
    .on(`transaction_${chainId}`)
    .columns(["block_number asc", "transaction_index asc"])
    .execute();
  await db.schema
    .createIndex(`transaction_${chainId}_hash_index`)
    .ifNotExists()
    .on(`transaction_${chainId}`)
    .columns(["hash asc"])
    .execute();
  await db.schema
    .createIndex(`transaction_${chainId}_from_index`)
    .ifNotExists()
    .on(`transaction_${chainId}`)
    .columns(["from asc", "checkpoint asc"])
    .execute();
  await db.schema
    .createIndex(`transaction_${chainId}_to_index`)
    .ifNotExists()
    .on(`transaction_${chainId}`)
    .columns(["to asc", "checkpoint asc"])
    .execute();

  // transaction_receipt
  await db.schema
    .createTable(`transaction_receipt_${chainId}`)
    .ifNotExists()
    // ID columns
    .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("transaction_index", "integer", (col) => col.notNull())
    .addColumn("transaction_hash", "varchar(66)", (col) =>
      col.notNull().primaryKey(),
    )
    // Extra columns
    .addColumn("from", "varchar(42)", (col) => col.notNull())
    .addColumn("to", "varchar(42)")
    .addColumn("contract_address", "varchar(66)")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("cumulative_gas_used", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("effective_gas_price", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("logs_bloom", "varchar(514)", (col) => col.notNull())
    .addPrimaryKeyConstraint(`transaction_receipt_${chainId}_pkey`, [
      "block_number",
      "transaction_index",
    ])
    .execute();

  // trace
  await db.schema
    .createTable(`trace_${chainId}`)
    .ifNotExists()
    // ID columns
    .addColumn("checkpoint", "varchar(75)", (col) => col.notNull().primaryKey())
    .addColumn("block_number", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("block_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("transaction_index", "integer", (col) => col.notNull())
    .addColumn("transaction_hash", "varchar(66)", (col) => col.notNull())
    .addColumn("trace_index", "integer", (col) => col.notNull())
    // Filter columns
    .addColumn("from", "varchar(42)", (col) => col.notNull())
    .addColumn("to", "varchar(42)")
    .addColumn("value", "numeric(78, 0)")
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("function_selector", "text", (col) => col.notNull())
    .addColumn("is_reverted", "integer", (col) => col.notNull())
    // Extra columns
    .addColumn("gas", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("gas_used", "numeric(78, 0)", (col) => col.notNull())
    .addColumn("input", "text", (col) => col.notNull())
    .addColumn("output", "text")
    .addColumn("error", "text")
    .addColumn("revert_reason", "text")
    .addColumn("subcalls", "integer", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex(`trace_${chainId}_ordering_index`)
    .ifNotExists()
    .on(`trace_${chainId}`)
    .columns(["block_number asc", "transaction_index asc"])
    .execute();
  await db.schema
    .createIndex(`trace_${chainId}_from_index`)
    .ifNotExists()
    .on(`trace_${chainId}`)
    .columns(["from asc", "checkpoint asc"])
    .execute();
  await db.schema
    .createIndex(`trace_${chainId}_to_index`)
    .ifNotExists()
    .on(`trace_${chainId}`)
    .columns(["to asc", "checkpoint asc"])
    .execute();

  // rpc_request
  await db.schema
    .createTable(`rpc_request_${chainId}`)
    .ifNotExists()
    .addColumn("request_hash", "text", (col) =>
      col.generatedAlwaysAs(sql`MD5(request)`).stored().notNull().primaryKey(),
    )
    .addColumn("request", "text", (col) => col.notNull())
    .addColumn("result", "text", (col) => col.notNull())
    .addColumn("block_number", "numeric(78, 0)")
    .execute();
}

export async function moveLegacyTables({
  common,
  db,
  newSchemaName,
}: {
  common: Common;
  db: Kysely<any>;
  newSchemaName: string;
}) {
  // If the database has ponder migration tables present in the public schema,
  // move them to the new schema.
  let hasLegacyMigrations = false;
  try {
    const { rows } = await db.executeQuery<{ name: string }>(
      sql`SELECT * FROM public.kysely_migration LIMIT 1`.compile(db),
    );
    if (rows[0]?.name === "2023_05_15_0_initial") hasLegacyMigrations = true;
  } catch (e) {
    const error = e as Error;
    if (!error.message.includes("does not exist")) throw error;
  }

  if (!hasLegacyMigrations) return;

  common.logger.warn({
    service: "database",
    msg: "Detected legacy sync migrations. Moving tables from 'public' schema to 'ponder_sync'.",
  });

  async function moveOrDeleteTable(tableName: string) {
    try {
      await db.schema
        .alterTable(`public.${tableName}`)
        .setSchema(newSchemaName)
        .execute();
    } catch (e) {
      const error = e as Error;
      switch (error.message) {
        case `relation "${tableName}" already exists in schema "${newSchemaName}"`: {
          await db.schema
            .dropTable(`public.${tableName}`)
            .execute()
            // Ignore errors if this fails.
            .catch(() => {});
          break;
        }
        case `relation "public.${tableName}" does not exist`: {
          break;
        }
        default: {
          common.logger.warn({
            service: "database",
            msg: `Failed to migrate table "${tableName}" to "ponder_sync" schema: ${error.message}`,
          });
        }
      }
    }

    common.logger.warn({
      service: "database",
      msg: `Successfully moved 'public.${tableName}' table to 'ponder_sync' schema.`,
    });
  }

  const tableNames = [
    "kysely_migration",
    "kysely_migration_lock",
    "blocks",
    "logs",
    "transactions",
    "rpcRequestResults",
    // Note that logFilterIntervals has a constraint that uses logFilters,
    // so the order here matters. Same story with factoryLogFilterIntervals.
    "logFilterIntervals",
    "logFilters",
    "factoryLogFilterIntervals",
    "factories",
    // Old ones that are no longer being used, but should still be moved
    // so that older migrations work as expected.
    "contractReadResults",
    "logFilterCachedRanges",
  ];

  for (const tableName of tableNames) {
    await moveOrDeleteTable(tableName);
  }
}
