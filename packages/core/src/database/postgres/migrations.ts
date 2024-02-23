import { type Kysely } from "kysely";
import { type Migration, type MigrationProvider } from "kysely";

const migrations: Record<string, Migration> = {
  "2024_01_29_0_initial": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("lock")
        .addColumn("id", "text", (col) => col.notNull().primaryKey())
        .addColumn("instance_id", "text", (col) => col.notNull())
        .addColumn("schema", "text", (col) => col.notNull())
        .execute();

      await db.schema
        .createTable("metadata")
        .addColumn("functionId", "text", (col) => col.notNull().primaryKey())
        .addColumn("fromCheckpoint", "varchar(58)")
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

export type PonderCoreSchema = {
  lock: {
    id: string;
    instance_id: string;
    schema: string;
  };
  metadata: {
    functionId: string;
    fromCheckpoint: string | null;
    toCheckpoint: string;
    eventCount: number;
  };
};
