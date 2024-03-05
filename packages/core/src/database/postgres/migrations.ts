import type { Schema } from "@/schema/types.js";
import { type Generated, type JSONColumnType, type Kysely } from "kysely";
import { type Migration, type MigrationProvider } from "kysely";

const migrations: Record<string, Migration> = {
  "2024_01_29_0_initial": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("function_metadata")
        .addColumn("function_id", "text", (col) => col.notNull().primaryKey())
        .addColumn("function_name", "text", (col) => col.notNull())
        .addColumn("hash_version", "integer", (col) => col.notNull())
        .addColumn("from_checkpoint", "varchar(58)")
        .addColumn("to_checkpoint", "varchar(58)", (col) => col.notNull())
        .addColumn("event_count", "integer", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("table_metadata")
        .addColumn("table_id", "text", (col) => col.notNull().primaryKey())
        .addColumn("table_name", "text", (col) => col.notNull())
        .addColumn("hash_version", "integer", (col) => col.notNull())
        .addColumn("to_checkpoint", "varchar(58)", (col) => col.notNull())
        .addColumn("schema", "jsonb", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("instance_metadata")
        .addColumn("instance_id", "serial", (col) => col.notNull().primaryKey()) // Auto-increment
        .addColumn("hash_version", "integer", (col) => col.notNull())
        .addColumn("schema", "jsonb", (col) => col.notNull())
        .addColumn("created_at", "bigint", (col) => col.notNull())
        .addColumn("heartbeat_at", "bigint", (col) => col.notNull())
        .addColumn("published_at", "bigint")
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

export type PonderCoreSchema = {
  "ponder_cache.function_metadata": {
    function_id: string;
    function_name: string;
    hash_version: number;
    from_checkpoint: string | null;
    to_checkpoint: string;
    event_count: number;
  };
  "ponder_cache.table_metadata": {
    table_id: string;
    table_name: string;
    hash_version: number;
    to_checkpoint: string;
    schema: JSONColumnType<Schema>;
  };
  "ponder_cache.instance_metadata": {
    instance_id: Generated<number>;
    hash_version: number;
    schema: JSONColumnType<Schema>;
    created_at: bigint;
    heartbeat_at: bigint;
    published_at: bigint | null;
  };
};
