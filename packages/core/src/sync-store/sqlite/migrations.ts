import type { Kysely, Migration, MigrationProvider } from "kysely";
import { sql } from "kysely";

const migrations: Record<string, Migration> = {
  "2023_05_15_0_initial": {
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
        .addColumn("baseFeePerGas", "varchar(79)")
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("difficulty", "varchar(79)", (col) => col.notNull())
        .addColumn("extraData", "text", (col) => col.notNull())
        .addColumn("gasLimit", "varchar(79)", (col) => col.notNull())
        .addColumn("gasUsed", "varchar(79)", (col) => col.notNull())
        .addColumn("hash", "varchar(66)", (col) => col.notNull().primaryKey())
        .addColumn("logsBloom", "varchar(514)", (col) => col.notNull())
        .addColumn("miner", "varchar(42)", (col) => col.notNull())
        .addColumn("mixHash", "varchar(66)", (col) => col.notNull())
        .addColumn("nonce", "varchar(18)", (col) => col.notNull())
        .addColumn("number", "varchar(79)", (col) => col.notNull())
        .addColumn("parentHash", "varchar(66)", (col) => col.notNull())
        .addColumn("receiptsRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("sha3Uncles", "varchar(66)", (col) => col.notNull())
        .addColumn("size", "varchar(79)", (col) => col.notNull())
        .addColumn("stateRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("timestamp", "varchar(79)", (col) => col.notNull())
        .addColumn("totalDifficulty", "varchar(79)", (col) => col.notNull())
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
        .addColumn("blockNumber", "varchar(79)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("from", "varchar(42)", (col) => col.notNull())
        .addColumn("gas", "varchar(79)", (col) => col.notNull())
        .addColumn("gasPrice", "varchar(79)")
        .addColumn("hash", "varchar(66)", (col) => col.notNull().primaryKey())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("maxFeePerGas", "varchar(79)")
        .addColumn("maxPriorityFeePerGas", "varchar(79)")
        .addColumn("nonce", "integer", (col) => col.notNull())
        .addColumn("r", "varchar(66)", (col) => col.notNull())
        .addColumn("s", "varchar(66)", (col) => col.notNull())
        .addColumn("to", "varchar(42)")
        .addColumn("transactionIndex", "integer", (col) => col.notNull())
        .addColumn("type", "text", (col) => col.notNull())
        .addColumn("value", "varchar(79)", (col) => col.notNull())
        .addColumn("v", "varchar(79)", (col) => col.notNull())
        .execute();

      await db.schema.dropTable("logs").execute();
      await db.schema
        .createTable("logs")
        .addColumn("address", "varchar(42)", (col) => col.notNull())
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "varchar(79)", (col) => col.notNull())
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
        .addColumn("blockNumber", "varchar(79)", (col) => col.notNull())
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
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("logFilterId", "text", (col) =>
          col.notNull().references("logFilters.id"),
        )
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
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
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryId", "text", (col) =>
          col.notNull().references("factories.id"),
        )
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
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
        .addColumn("blockNumber", "varchar(79)", (col) => col.notNull())
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
  "2024_02_1_0_nullable_block_columns": {
    async up(db: Kysely<any>) {
      // SQLite doesn't support dropping NOT NULL constraints. As a workaround:
      // 1) Create a new column of the same type without NOT NULL.
      // 2) Copy data from the old column to the new column.
      // 3) Drop the old column.
      // 4) Rename the new column to the old column's name.

      // Drop NOT NULL constraint from "blocks.mixHash".
      await db.schema
        .alterTable("blocks")
        .addColumn("mixHash_temp_null", "varchar(66)")
        .execute();
      await db
        .updateTable("blocks")
        .set((eb: any) => ({
          mixHash_temp_null: eb.selectFrom("blocks").select("mixHash"),
        }))
        .execute();
      await db.schema.alterTable("blocks").dropColumn("mixHash").execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("mixHash_temp_null", "mixHash")
        .execute();

      // Drop NOT NULL constraint from "blocks.nonce".
      await db.schema
        .alterTable("blocks")
        .addColumn("nonce_temp_null", "varchar(18)")
        .execute();
      await db
        .updateTable("blocks")
        .set((eb: any) => ({
          nonce_temp_null: eb.selectFrom("blocks").select("nonce"),
        }))
        .execute();
      await db.schema.alterTable("blocks").dropColumn("nonce").execute();
      await db.schema
        .alterTable("blocks")
        .renameColumn("nonce_temp_null", "nonce")
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
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "sha3Uncles",
        columnType: "varchar(66)",
      });
    },
  },
  "2024_03_14_0_nullable_transaction_rsv": {
    async up(db: Kysely<any>) {
      await columnDropNotNull({
        db,
        table: "transactions",
        column: "r",
        columnType: "varchar(66)",
      });
      await columnDropNotNull({
        db,
        table: "transactions",
        column: "s",
        columnType: "varchar(66)",
      });
      await columnDropNotNull({
        db,
        table: "transactions",
        column: "v",
        columnType: "varchar(79)",
      });
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
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "totalDifficulty",
        columnType: "varchar(79)",
      });
    },
  },
  "2024_04_14_1_add_checkpoint_column_to_logs_table": {
    async up(db: Kysely<any>) {
      if (await hasCheckpointCol(db)) {
        return;
      }
      await db.schema
        .alterTable("logs")
        .addColumn("checkpoint", "varchar(75)")
        .execute();
    },
  },
  "2024_04_14_2_set_checkpoint_in_logs_table": {
    async up(db: Kysely<any>) {
      await db.executeQuery(
        sql`
        CREATE TEMPORARY TABLE cp_vals AS
        SELECT 
          logs.id,
          substr(blocks.timestamp, -10, 10) ||
            substr('0000000000000000' || blocks.chainId, -16, 16) ||
            substr(blocks.number, -16, 16) ||
            substr('0000000000000000' || logs.transactionIndex, -16, 16) ||
            '5' ||
            substr('0000000000000000' || logs.logIndex, -16, 16) as checkpoint
          FROM logs
          JOIN blocks ON logs."blockHash" = blocks.hash
      `.compile(db),
      );

      await db.executeQuery(
        sql`
        UPDATE logs 
        SET checkpoint=cp_vals.checkpoint
        FROM cp_vals
        WHERE logs.id = cp_vals.id
      `.compile(db),
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
      // Disable foriegn keys for the duration of this transaction.
      await db.executeQuery(sql`PRAGMA foreign_keys = 0`.compile(db));

      // Rename and update the existing tables to include the data we want. Note that
      // these tables have constraints that we do NOT want. They won't get copied over.
      await db.schema
        .alterTable("logFilters")
        .renameTo("logFilters_temp")
        .execute();
      await db
        .updateTable("logFilters_temp")
        .set({ id: sql`"id" || '_0'` })
        .execute();
      await db.schema
        .alterTable("logFilters_temp")
        .addColumn("includeTransactionReceipts", "integer", (col) =>
          col.notNull().defaultTo(0),
        )
        .execute();
      await db.schema
        .alterTable("logFilterIntervals")
        .renameTo("logFilterIntervals_temp")
        .execute();
      await db
        .updateTable("logFilterIntervals_temp")
        .set({ logFilterId: sql`"logFilterId" || '_0'` })
        .execute();

      await db.schema
        .createTable("logFilters")
        // `${chainId}_${address}_${topic0}_${topic1}_${topic2}_${topic3}_${includeTransactionReceipts}`
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(66)")
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .addColumn("includeTransactionReceipts", "integer", (col) =>
          col.notNull(),
        )
        .execute();
      await db.schema
        .createTable("logFilterIntervals")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        // Note that we removed the foreign key constraint here.
        .addColumn("logFilterId", "text", (col) => col.notNull())
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
        .execute();
      // Copy data from temp tables to new tables.
      await db.executeQuery(
        sql`INSERT INTO "logFilters" SELECT * FROM "logFilters_temp"`.compile(
          db,
        ),
      );
      await db.executeQuery(
        sql`INSERT INTO "logFilterIntervals" SELECT * FROM "logFilterIntervals_temp"`.compile(
          db,
        ),
      );
      // Drop the temp tables.
      await db.schema.dropTable("logFilters_temp").execute();
      await db.schema.dropTable("logFilterIntervals_temp").execute();
      // Add back the index.
      await db.schema
        .createIndex("logFilterIntervalsLogFilterId")
        .on("logFilterIntervals")
        .column("logFilterId")
        .execute();

      // Repeat the same process for factories.
      await db.schema
        .alterTable("factories")
        .renameTo("factories_temp")
        .execute();
      await db
        .updateTable("factories_temp")
        .set({ id: sql`"id" || '_0'` })
        .execute();
      await db.schema
        .alterTable("factories_temp")
        .addColumn("includeTransactionReceipts", "integer", (col) =>
          col.notNull().defaultTo(0),
        )
        .execute();
      await db.schema
        .alterTable("factoryLogFilterIntervals")
        .renameTo("factoryLogFilterIntervals_temp")
        .execute();
      await db
        .updateTable("factoryLogFilterIntervals_temp")
        .set({ factoryId: sql`"factoryId" || '_0'` })
        .execute();
      await db.schema
        .createTable("factories")
        // `${chainId}_${address}_${eventSelector}_${childAddressLocation}_${topic0}_${topic1}_${topic2}_${topic3}_${includeTransactionReceipts}`
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("address", "varchar(42)", (col) => col.notNull())
        .addColumn("eventSelector", "varchar(66)", (col) => col.notNull())
        .addColumn("childAddressLocation", "text", (col) => col.notNull()) // `topic${number}` or `offset${number}`
        .addColumn("topic0", "varchar(66)")
        .addColumn("topic1", "varchar(66)")
        .addColumn("topic2", "varchar(66)")
        .addColumn("topic3", "varchar(66)")
        .addColumn("includeTransactionReceipts", "integer", (col) =>
          col.notNull(),
        )
        .execute();
      await db.schema
        .createTable("factoryLogFilterIntervals")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        // Note that we removed the foreign key constraint here.
        .addColumn("factoryId", "text", (col) => col.notNull())
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
        .execute();
      await db.executeQuery(
        sql`INSERT INTO "factories" SELECT * FROM "factories_temp"`.compile(db),
      );
      await db.executeQuery(
        sql`INSERT INTO "factoryLogFilterIntervals" SELECT * FROM "factoryLogFilterIntervals_temp"`.compile(
          db,
        ),
      );
      await db.schema.dropTable("factories_temp").execute();
      await db.schema.dropTable("factoryLogFilterIntervals_temp").execute();
      await db.schema
        .createIndex("factoryLogFilterIntervalsFactoryId")
        .on("factoryLogFilterIntervals")
        .column("factoryId")
        .execute();

      await db.schema
        .createTable("transactionReceipts")
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "varchar(79)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("contractAddress", "varchar(66)")
        .addColumn("cumulativeGasUsed", "varchar(79)", (col) => col.notNull())
        .addColumn("effectiveGasPrice", "varchar(79)", (col) => col.notNull())
        .addColumn("from", "varchar(42)", (col) => col.notNull())
        .addColumn("gasUsed", "varchar(79)", (col) => col.notNull())
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

      await db.executeQuery(sql`PRAGMA foreign_keys = 1`.compile(db));
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
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("blockFilterId", "text", (col) =>
          col.notNull().references("blockFilters.id"),
        )
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
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
          CREATE TEMPORARY TABLE bcp_vals AS
          SELECT 
            blocks.hash,
            substr(blocks.timestamp, -10, 10) ||
              substr('0000000000000000' || blocks.chainId, -16, 16) ||
              substr(blocks.number, -16, 16) ||
              '9999999999999999' ||
              '5' ||
              '0000000000000000' as checkpoint
            FROM blocks
        `.compile(db),
      );
      await db.executeQuery(
        sql`
          UPDATE blocks 
          SET checkpoint=bcp_vals.checkpoint
          FROM bcp_vals
          WHERE blocks.hash = bcp_vals.hash
        `.compile(db),
      );

      await db.schema.alterTable("blocks").renameTo("blocks_temp").execute();

      await db.schema
        .createTable("blocks")
        .addColumn("baseFeePerGas", "varchar(79)")
        .addColumn("difficulty", "varchar(79)", (col) => col.notNull())
        .addColumn("extraData", "text", (col) => col.notNull())
        .addColumn("gasLimit", "varchar(79)", (col) => col.notNull())
        .addColumn("gasUsed", "varchar(79)", (col) => col.notNull())
        .addColumn("hash", "varchar(66)", (col) => col.notNull().primaryKey())
        .addColumn("logsBloom", "varchar(514)", (col) => col.notNull())
        .addColumn("miner", "varchar(42)", (col) => col.notNull())
        .addColumn("mixHash", "varchar(66)", (col) => col.notNull())
        .addColumn("nonce", "varchar(18)", (col) => col.notNull())
        .addColumn("number", "varchar(79)", (col) => col.notNull())
        .addColumn("parentHash", "varchar(66)", (col) => col.notNull())
        .addColumn("receiptsRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("sha3Uncles", "varchar(66)", (col) => col.notNull())
        .addColumn("size", "varchar(79)", (col) => col.notNull())
        .addColumn("stateRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("timestamp", "varchar(79)", (col) => col.notNull())
        .addColumn("totalDifficulty", "varchar(79)", (col) => col.notNull())
        .addColumn("transactionsRoot", "varchar(66)", (col) => col.notNull())
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("checkpoint", "varchar(75)", (col) => col.notNull())
        .execute();

      await db.executeQuery(
        sql`INSERT INTO "blocks" SELECT * FROM "blocks_temp"`.compile(db),
      );

      await db.schema.dropTable("blocks_temp").execute();

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
      // The blocks.number index supports getEvents
      await db.schema
        .createIndex("blockCheckpointIndex")
        .on("blocks")
        .column("checkpoint")
        .execute();
    },
  },
  "2024_05_06_0_drop_not_null_block_columns": {
    async up(db: Kysely<any>) {
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "baseFeePerGas",
        columnType: "varchar(79)",
      });
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "mixHash",
        columnType: "varchar(66)",
      });
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "nonce",
        columnType: "varchar(18)",
      });
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "sha3Uncles",
        columnType: "varchar(66)",
      });
      await columnDropNotNull({
        db,
        table: "blocks",
        column: "totalDifficulty",
        columnType: "varchar(79)",
      });
    },
  },
  "2024_05_07_0_trace_filters": {
    async up(db: Kysely<any>) {
      // TODO(kyle) drop foreign key constraint on "blockFilterIntervals.blockFilterId".

      await db.schema
        .createTable("traceFilters")
        .addColumn("id", "text", (col) => col.notNull().primaryKey()) // `${chainId}_${fromAddress}_${toAddress}_${includeTransactionReceipts}`
        .addColumn("chainId", "integer", (col) => col.notNull())
        .addColumn("fromAddress", "varchar(42)")
        .addColumn("toAddress", "varchar(42)")
        .execute();
      await db.schema
        .createTable("traceFilterIntervals")
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("traceFilterId", "text", (col) => col.notNull())
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
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
        .addColumn("gas", "varchar(79)", (col) => col.notNull())
        .addColumn("input", "text", (col) => col.notNull())
        .addColumn("to", "varchar(42)", (col) => col.notNull())
        .addColumn("value", "varchar(79)", (col) => col.notNull())
        .addColumn("blockHash", "varchar(66)", (col) => col.notNull())
        .addColumn("blockNumber", "varchar(79)", (col) => col.notNull())
        .addColumn("error", "text")
        .addColumn("gasUsed", "varchar(79)")
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
        .addColumn("id", "integer", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("factoryId", "text")
        .addColumn("startBlock", "varchar(79)", (col) => col.notNull())
        .addColumn("endBlock", "varchar(79)", (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex("factoryTraceFilterIntervalsFactoryId")
        .on("factoryTraceFilterIntervals")
        .column("factoryId")
        .execute();
    },
  },
};

async function hasCheckpointCol(db: Kysely<any>) {
  const res = await db.executeQuery(sql`PRAGMA table_info("logs")`.compile(db));
  return res.rows.some((x: any) => x.name === "checkpoint");
}

const columnDropNotNull = async ({
  db,
  table,
  column,
  columnType,
}: {
  db: Kysely<any>;
  table: string;
  column: string;
  columnType: Parameters<
    ReturnType<Kysely<any>["schema"]["alterTable"]>["addColumn"]
  >[1];
}) => {
  const tempName = `${column}_temp_null`;

  await db.schema.alterTable(table).addColumn(tempName, columnType).execute();
  await db
    .updateTable(table)
    .set((eb: any) => ({ [tempName]: eb.selectFrom(table).select(column) }))
    .execute();
  await db.schema.alterTable(table).dropColumn(column).execute();
  await db.schema.alterTable(table).renameColumn(tempName, column).execute();
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();
