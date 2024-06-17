import type { Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely";

const migrations: Record<string, Migration> = {
  "2024_03_28_0_initial": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("namespace_lock")
        .ifNotExists()
        .addColumn("namespace", "text", (col) => col.notNull().primaryKey())
        .addColumn("is_locked", "integer", (col) => col.notNull())
        .addColumn("heartbeat_at", "bigint", (col) => col.notNull())
        .addColumn("build_id", "text", (col) => col.notNull())
        .addColumn("finalized_checkpoint", "varchar(75)", (col) =>
          col.notNull(),
        )
        .addColumn("schema", "jsonb", (col) => col.notNull())
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

export type InternalTables = {
  namespace_lock: {
    namespace: string;
    is_locked: number;
    heartbeat_at: number;
    build_id: string;
    finalized_checkpoint: string;
    schema: string;
  };
};
