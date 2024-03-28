import { type Kysely } from "kysely";
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
    },
  },
  "2024_03_28_0_bigly": {
    async up(db: Kysely<any>) {
      await db.schema.dropTable("function_metadata").execute();
      await db.schema.dropTable("table_metadata").execute();
    },
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();
