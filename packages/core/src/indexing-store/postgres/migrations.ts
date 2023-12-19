import type { Kysely } from "kysely";
import { CompiledQuery, type Migration, type MigrationProvider } from "kysely";

const migrations: Record<string, Migration> = {
  ["2023_12_19_0_metadata"]: {
    async up(db: Kysely<any>) {
      await db.schema
        .withSchema("public")
        .createTable("ponder_metadata")
        .ifNotExists()
        .addColumn("namespace_version", "text", (col) => col.primaryKey())
        .addColumn("schema", "jsonb")
        .addColumn("is_published", "boolean", (col) => col.defaultTo(false))
        .execute();

      await db.withSchema("public").executeQuery(
        CompiledQuery.raw(`
              CREATE OR REPLACE FUNCTION notify_ponder_after_namespace_publish()
              RETURNS TRIGGER AS
              $BODY$
                  BEGIN
                      PERFORM pg_notify('namespace_published', row_to_json(NEW)::text);
                      RETURN new;
                  END;
              $BODY$
              LANGUAGE plpgsql
        `),
      );

      await db.withSchema("public").executeQuery(
        CompiledQuery.raw(`
          CREATE OR REPLACE TRIGGER trigger_notify_ponder_after_namespace_publish
          AFTER UPDATE OF is_published
          ON "public"."ponder_metadata"
          FOR EACH ROW
          EXECUTE PROCEDURE notify_ponder_after_namespace_publish();
         `),
      );
    },
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export const migrationProvider = new StaticMigrationProvider();
