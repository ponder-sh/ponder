import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import { PonderSchema } from "@/core/schema/types";

import { BaseStore, StoreKind } from "./base";

export class SqliteStore implements BaseStore {
  kind = StoreKind.SQLITE;
  db: Sqlite.Database;

  constructor(
    filename = ":memory:",
    options: Sqlite.Options = {
      verbose: logger.debug,
    }
  ) {
    this.db = Sqlite(filename, options);
  }

  /* This method is responsible for dropping*/
  async migrate(schema: PonderSchema) {
    const entities = Object.values(schema.entities);

    entities.forEach((entity) => {
      // Drop the table if it already exists
      this.db.prepare(`drop table if exists \`${entity.name}\``).run();

      // Build the create table statement using field migration fragments.
      // TODO: Update this so the generation of the field migration fragments happens here
      // instead of when the PonderSchema gets built.
      const columnStatements = entity.fields.map(
        (field) => field.migrateUpStatement
      );
      columnStatements.push(`\`createdAt\` datetime`, `\`updatedAt\` datetime`);

      this.db
        .prepare(
          `create table \`${entity.name}\` (${columnStatements.join(", ")})`
        )
        .run();
    });
  }

  async getEntity<T>(entity: string, id: string): Promise<T | null> {
    const entityInstance = this.db
      .prepare(`select * from \`${entity}\` where id = '@id'`)
      .get({
        id: id,
      });

    return entityInstance || null;
  }

  async getEntities<T>(entity: string, id: string, filter: any): Promise<T[]> {
    return [];
  }

  async insertEntity<T>(
    entity: string,
    attributes: { id: string } & unknown
  ): Promise<T> {
    const columnStatements = Object.entries(attributes).map(
      ([column, value]) => ({
        column: `\`${column}\``,
        value: `'${value}'`,
      })
    );

    const insertFragment = `(${columnStatements
      .map((s) => s.column)
      .join(", ")}) values (${columnStatements
      .map((s) => s.value)
      .join(", ")})`;

    const statement = `insert into \`${entity}\` ${insertFragment} returning *`;
    const insertedEntity = this.db.prepare(statement).get();

    return insertedEntity;
  }

  async upsertEntity<T>(
    entity: string,
    attributes: { id: string } & unknown
  ): Promise<T> {
    const columnStatements = Object.entries(attributes).map(
      ([column, value]) => ({
        column: `\`${column}\``,
        value: `'${value}'`,
      })
    );

    const insertFragment = `(${columnStatements
      .map((s) => s.column)
      .join(", ")}) values (${columnStatements
      .map((s) => s.value)
      .join(", ")})`;

    const updateFragment = columnStatements
      .filter((s) => s.column !== "id")
      .map((s) => `${s.column}=excluded.${s.column}`)
      .join(", ");

    const statement = `insert into \`${entity}\` ${insertFragment} on conflict(\`id\`) do update set ${updateFragment} returning *`;
    const upsertedEntity = this.db.prepare(statement).get();

    return upsertedEntity;
  }

  async deleteEntity(entity: string, id: string): Promise<void> {
    const statement = `delete from \`${entity}\` where \`id\` = '@id'`;

    this.db.prepare(statement).run({ id: id });

    return;
  }
}
