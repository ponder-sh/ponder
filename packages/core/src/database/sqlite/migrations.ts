import type { Kysely } from "kysely";
import { type Migration, type MigrationProvider } from "kysely";

const migrations: Record<string, Migration> = {
  "2024_01_29_0_initial": {
    async up(db: Kysely<any>) {
      await db.schema
        .withSchema("cold")
        .createTable("metadata")
        .addColumn("functionId", "text", (col) => col.notNull().primaryKey())
        .addColumn("fromCheckpoint", "varchar(58)", (col) => col.notNull())
        .addColumn("toCheckpoint", "varchar(58)", (col) => col.notNull())
        .addColumn("eventCount", "integer", (col) => col.notNull())
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
