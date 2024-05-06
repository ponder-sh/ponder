import { type Kysely } from "kysely";
import { type Migration, type MigrationProvider } from "kysely";

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
  "2024_05_06_0_table_names": {
    async up(db: Kysely<any>) {
      const rows = await db
        .selectFrom("namespace_lock")
        .select(["schema", "namespace"])
        .execute();

      await db.schema
        .alterTable("namespace_lock")
        .addColumn("table_names", "text")
        .execute();

      for (const row of rows) {
        await db
          .updateTable("namespace_lock")
          .set({ table_names: JSON.stringify(Object.keys(row.schema.tables)) })
          .where("namespace", "=", row.namespace)
          .execute();
      }

      await db.schema
        .alterTable("namespace_lock")
        .alterColumn("table_names", (col) => col.setNotNull())
        .execute();

      await db.schema
        .alterTable("namespace_lock")
        .dropColumn("schema")
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
    table_names: string;
  };
};
