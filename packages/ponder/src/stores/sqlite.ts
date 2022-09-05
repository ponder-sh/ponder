import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import { FieldKind, PonderSchema } from "@/core/schema/types";

import { BaseStore, StoreKind } from "./base";

export class SqliteStore implements BaseStore {
  kind = StoreKind.SQLITE;
  db: Sqlite.Database;
  schema?: PonderSchema;

  constructor(
    filename = ":memory:",
    options: Sqlite.Options = {
      verbose: logger.debug,
    }
  ) {
    this.db = Sqlite(filename, options);
  }

  async migrate(schema: PonderSchema) {
    schema.entities.forEach((entity) => {
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

    this.schema = schema;
  }

  async getEntity<T>(entityName: string, id: string): Promise<T | null> {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];

    console.log("in getEntity with:", entityName, id);

    const entityInstance = this.db
      .prepare(`select * from \`${entityName}\` where id = @id`)
      .get({
        id: id,
      });

    if (!entityInstance) {
      return null;
    }

    Object.entries(entityInstance).forEach(([fieldName, value]) => {
      const field = entity.fieldByName[fieldName];
      if (field?.kind === FieldKind.LIST) {
        // `value` is an array encoded as comma-separated value string, e.g. `alice,bob,tom`
        entityInstance[fieldName] = (value as string).split(",");
      }
    });

    return entityInstance;
  }

  async getEntities<T>(
    entityName: string,
    id: string,
    filter: any
  ): Promise<T[]> {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    return [];
  }

  async insertEntity<T>(
    entityName: string,
    attributes: { id: string } & unknown
  ): Promise<T> {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];

    const columnStatements = Object.entries(attributes).map(
      ([fieldName, value]) => {
        const field = entity.fieldByName[fieldName];
        return {
          column: `\`${fieldName}\``,
          value: `'${value}'`,
        };
      }
    );

    const insertFragment = `(${columnStatements
      .map((s) => s.column)
      .join(", ")}) values (${columnStatements
      .map((s) => s.value)
      .join(", ")})`;

    const statement = `insert into \`${entityName}\` ${insertFragment} returning *`;
    const insertedEntity = this.db.prepare(statement).get();

    return insertedEntity;
  }

  async upsertEntity<T>(
    entityName: string,
    attributes: { id: string } & unknown
  ): Promise<T> {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];

    const columnStatements = Object.entries(attributes).map(
      ([fieldName, value]) => {
        const field = entity.fieldByName[fieldName];
        return {
          column: `\`${fieldName}\``,
          value: `'${value}'`,
        };
      }
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

    const statement = `insert into \`${entityName}\` ${insertFragment} on conflict(\`id\`) do update set ${updateFragment} returning *`;
    const upsertedEntity = this.db.prepare(statement).get();

    return upsertedEntity;
  }

  async deleteEntity(entityName: string, id: string): Promise<void> {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const statement = `delete from \`${entityName}\` where \`id\` = '@id'`;

    this.db.prepare(statement).run({ id: id });

    return;
  }
}
