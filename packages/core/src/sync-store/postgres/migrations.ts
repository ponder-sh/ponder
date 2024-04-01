import type { Common } from "@/common/common.js";
import { EVENT_TYPES, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { Kysely } from "kysely";
import { type Migration, type MigrationProvider, sql } from "kysely";

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
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable("logs")
        .addColumn("checkpoint", "varchar(75)")
        .execute();
      await db.executeQuery(
        sql`
          WITH checkpoint_vals AS (
            SELECT logs.id, blocks.timestamp, blocks."chainId", blocks.number, logs."transactionIndex", logs."logIndex"
            FROM ponder_sync.logs logs
            JOIN ponder_sync.blocks blocks ON logs."blockHash" = blocks.hash
          )
          UPDATE ponder_sync.logs
          SET checkpoint=
              (lpad(checkpoint_vals.timestamp::text, 10, '0') ||
              lpad(checkpoint_vals."chainId"::text, 16, '0') ||
              lpad(checkpoint_vals.number::text, 16, '0') ||
              lpad(checkpoint_vals."transactionIndex"::text, 16, '0') ||
              '5' ||
              lpad(checkpoint_vals."logIndex"::text, 16, '0'))
          FROM checkpoint_vals
          WHERE ponder_sync.logs.id = checkpoint_vals.id;
        `.compile(db),
      );

      // sanity check our checkpoint encoding on the first 10 rows of the table
      const checkRes = await db.executeQuery<{
        timestamp: number;
        chainId: number;
        number: number;
        transactionIndex: number;
        logIndex: number;
        checkpoint: bigint;
      }>(
        sql`
          SELECT blocks.timestamp, blocks."chainId", blocks.number, logs."transactionIndex", logs."logIndex", logs.checkpoint
          FROM ponder_sync.logs logs
          JOIN ponder_sync.blocks blocks ON logs."blockHash" = blocks.hash
          LIMIT 10
        `.compile(db),
      );

      for (const row of checkRes.rows) {
        const expected = encodeCheckpoint({
          blockTimestamp: row.timestamp,
          chainId: row.chainId,
          blockNumber: row.number,
          transactionIndex: row.transactionIndex,
          eventType: EVENT_TYPES.logs,
          eventIndex: row.logIndex,
        });

        if (row.checkpoint.toString() !== expected) {
          throw new Error(
            `data migration failed: expected new checkpoint column to have value ${expected} but got ${row.checkpoint}`,
          );
        }
      }

      await db.schema
        .createIndex("logs_checkpoint_index")
        .on("logs")
        .column("checkpoint")
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
