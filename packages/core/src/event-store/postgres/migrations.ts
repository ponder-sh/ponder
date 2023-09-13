import { type Migration, type MigrationProvider, Kysely, sql } from "kysely";

import { blobToBigInt } from "@/utils/decode";

const migrations: Record<string, Migration> = {
  ["2023_05_15_0_initial"]: {
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
    async down(db: Kysely<any>) {
      await db.schema.dropTable("blocks").execute();
      await db.schema.dropTable("logs").execute();
      await db.schema.dropTable("transactions").execute();
      await db.schema.dropTable("contractReadResults").execute();
      await db.schema.dropTable("logFilterCachedRanges").execute();
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
    async down(db: Kysely<any>) {
      await db.schema.dropIndex("log_events_index").execute();
      await db.schema.dropIndex("blocks_index").execute();
      await db.schema.dropIndex("logFilterCachedRanges_index").execute();
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
    async down(db: Kysely<any>) {
      await db.schema.dropIndex("log_block_hash_index").execute();
      await db.schema.dropIndex("log_chain_id_index").execute();
      await db.schema.dropIndex("log_address_index").execute();
      await db.schema.dropIndex("log_topic0_index").execute();
      await db.schema.dropIndex("block_timestamp_index").execute();
      await db.schema.dropIndex("block_number_index").execute();
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
    async down(db: Kysely<any>) {
      await db.schema
        .alterTable("blocks")
        .addColumn("finalized", "integer", (col) => col.notNull())
        .execute();
      await db.schema
        .alterTable("transactions")
        .addColumn("finalized", "integer", (col) => col.notNull())
        .execute();
      await db.schema
        .alterTable("logs")
        .addColumn("finalized", "integer", (col) => col.notNull())
        .execute();
      await db.schema
        .alterTable("contractReadResults")
        .addColumn("finalized", "integer", (col) => col.notNull())
        .execute();
    },
  },
  ["2023_09_12_0_use_numeric_for_bigint"]: {
    async up(db: Kysely<any>) {
      // table name, primary key col name, col name to convert, is not null
      const bigintColumns = [
        ["blocks", "hash", "baseFeePerGas", false],
        ["blocks", "hash", "difficulty", true],
        ["blocks", "hash", "gasLimit", true],
        ["blocks", "hash", "gasUsed", true],
        ["blocks", "hash", "number", true],
        ["blocks", "hash", "size", true],
        ["blocks", "hash", "timestamp", true],
        ["blocks", "hash", "totalDifficulty", true],
        ["transactions", "hash", "blockNumber", true],
        ["transactions", "hash", "gas", true],
        ["transactions", "hash", "v", true],
        ["transactions", "hash", "value", true],
        ["transactions", "hash", "gasPrice", false],
        ["transactions", "hash", "maxFeePerGas", false],
        ["transactions", "hash", "maxPriorityFeePerGas", false],
        ["logs", "id", "blockNumber", true],
        ["logFilterCachedRanges", "id", "startBlock", true],
        ["logFilterCachedRanges", "id", "endBlock", true],
        ["logFilterCachedRanges", "id", "endBlockTimestamp", true],
      ] as const;

      for (const [table, pk, column, isNotNull] of bigintColumns) {
        const tempColumn = `${column}_temp`;

        console.log([table, column, isNotNull]);

        // Rename old column.
        await db.schema
          .alterTable(table)
          .renameColumn(column, tempColumn)
          .execute();

        console.log("ran rename");

        // Create new column with correct name and type.
        // Note that it is null to start.
        await db.schema
          .alterTable(table)
          .addColumn(column, "numeric(78, 0)")
          .execute();

        console.log("added new column");

        // const newSchema = await db.introspection.getTables();
        // console.log(newSchema);

        const batchSize = 5;
        let offset = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const rows = await db
            .selectFrom(table)
            .select([pk, tempColumn])
            .orderBy(pk, "asc")
            .offset(offset)
            .limit(batchSize)
            .execute();

          if (rows.length === 0) {
            break;
          }

          console.log({ rows });

          await Promise.all(
            rows
              .filter((row) => row[tempColumn] !== null)
              .map(async (row) => {
                await db
                  .updateTable(table)
                  .set({ [column]: blobToBigInt(row[tempColumn]) })
                  .where(pk, "=", row[pk])
                  .execute();
              })
          );

          offset += batchSize;
        }

        // Make new column not null if applicable.
        if (isNotNull) {
          await db.schema
            .alterTable(table)
            .alterColumn(column, (ac) => ac.setNotNull())
            .execute();
        }

        // Drop old column.
        await db.schema.alterTable(table).dropColumn(tempColumn).execute();
      }

      const blocks = await db.selectFrom("blocks").selectAll().execute();
      console.log({ blocks });

      // The contract reads table is annoying because of the composite PK,
      // so we'll just nuke it and create it fresh with the correct types.
      await db.schema.dropTable("contractReadResults").ifExists().execute();

      await db.schema
        .createTable("contractReadResults")
        .addColumn("address", "text", (col) => col.notNull())
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
    },
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();
