import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import {
  Entity,
  FieldKind,
  PonderSchema,
  RelationshipField,
} from "@/core/schema/types";

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

    const relationshipFields = entity.fields.filter(
      (field) => field.kind === FieldKind.RELATIONSHIP
    ) as RelationshipField[];

    const joinStatement = relationshipFields
      .map(
        (field) =>
          `inner join \`${field.relatedEntityName}\` on
          \`${field.relatedEntityName}\`.\`id\` = \`${entityName}\`.\`${field.name}\``
      )
      .join(" ");

    const relatedEntityInstances: Record<
      string,
      { field: RelationshipField; instance: any }
    > = {};

    const relationshipSelectStatement = relationshipFields
      .map((field) => {
        const relatedEntity =
          this.schema!.entityByName[field.relatedEntityName];

        const relatedEntityPrefix = `_entity_${relatedEntity.name}_end_`;

        const selectStat = relatedEntity.fields.map(
          (relatedEntityField) =>
            `\`${relatedEntity.name}\`.\`${relatedEntityField.name}\` as ${relatedEntityPrefix}${relatedEntityField.name}`
        );

        // Initialize the instance, we will add properties to it below.
        relatedEntityInstances[relatedEntity.name] = {
          field,
          instance: {},
        };

        return selectStat;
      })
      .join(",");

    const selectStatement = [
      `\`${entityName}\`.*`,
      relationshipSelectStatement,
    ].join(",");

    const statement = `select ${selectStatement}
      from \`${entityName}\` ${joinStatement}
      where \`${entityName}\`.\`id\` = @id`;

    const entityInstance = this.db.prepare(statement).get({
      id: id,
    });

    if (!entityInstance) {
      return null;
    }

    const baseEntityInstance: Record<string, any> = {};

    Object.entries(entityInstance).forEach(([propertyName, value]) => {
      if (propertyName.startsWith("_entity_")) {
        const [relatedEntityNameWithPrefix, relatedEntityPropertyName] =
          propertyName.split("_end_");
        const relatedEntityName = relatedEntityNameWithPrefix.substring(
          "_entity_".length
        );

        relatedEntityInstances[relatedEntityName].instance[
          relatedEntityPropertyName
        ] = value;
      } else {
        baseEntityInstance[propertyName] = value;
      }
    });

    const deserializedBaseEntityInstance = this.deserialize(
      entity.name,
      baseEntityInstance
    );

    const deserializedRelatedEntityInstances = Object.entries(
      relatedEntityInstances
    ).map(([entityName, { field, instance }]) => ({
      field: field,
      deserializedInstance: this.deserialize(entityName, instance),
    }));

    // Now, replace the related id fields with the actual entity instances.
    deserializedRelatedEntityInstances.forEach(
      ({ field, deserializedInstance }) => {
        deserializedBaseEntityInstance[field.name] = deserializedInstance;
      }
    );

    return deserializedBaseEntityInstance;
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

  deserialize(entityName: string, instance: any) {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];
    if (!entity) {
      throw new Error(`Entity not found in schema: ${entityName}`);
    }

    const deserializedInstance = { ...instance };

    // For each property on the instance, look for a field defined on the entity
    // with the same name and apply any required deserialization transforms.
    Object.entries(instance).forEach(([fieldName, value]) => {
      const field = entity.fieldByName[fieldName];
      if (!field) return;

      switch (field.kind) {
        case FieldKind.LIST: {
          deserializedInstance[fieldName] = (value as string).split(",");
          break;
        }
        default: {
          deserializedInstance[fieldName] = value;
        }
      }
    });

    return deserializedInstance;
  }
}
