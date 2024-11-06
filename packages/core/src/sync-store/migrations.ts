import type { Common } from "@/common/common.js";
import type { Kysely, Migration, MigrationProvider } from "kysely";
import { sql } from "kysely";

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
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();

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
