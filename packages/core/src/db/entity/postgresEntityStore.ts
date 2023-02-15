import type PgPromise from "pg-promise";

import { DerivedField, FieldKind, ScalarField, Schema } from "@/schema/types";

import type { EntityFilter, EntityStore } from "./entityStore";
import {
  getColumnValuePairs,
  getWhereValue,
  sqlSymbolsForFilterType,
} from "./utils";

export class PostgresEntityStore implements EntityStore {
  db: PgPromise.IDatabase<unknown>;
  pgp: PgPromise.IMain;

  schema?: Schema;

  constructor({
    db,
    pgp,
  }: {
    db: PgPromise.IDatabase<unknown>;
    pgp: PgPromise.IMain;
  }) {
    this.db = db;
    this.pgp = pgp;
  }

  async migrate(schema?: Schema) {
    if (!schema) return;
    this.schema = schema;

    this.schema.entities.forEach(async (entity) => {
      // Drop the table if it already exists
      await this.db.none(`DROP TABLE IF EXISTS "${entity.name}"`);

      // Build the create table statement using field migration fragments.
      // TODO: Update this so the generation of the field migration fragments happens here
      // instead of when the Schema gets built.
      const columnStatements = entity.fields
        .filter(
          // This type guard is wrong, could actually be any FieldKind that's not derived (obvs)
          (field): field is ScalarField => field.kind !== FieldKind.DERIVED
        )
        .map((field) => field.migrateUpStatement);

      await this.db.none(
        `CREATE TABLE "${entity.name}" (${columnStatements.join(", ")})`
      );
    });
  }

  async getEntity(entityName: string, id: string) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const statement = `SELECT "${entityName}".* FROM "${entityName}" WHERE "${entityName}"."id" = $1`;
    const instance = await this.db.oneOrNone(statement, [id]);

    if (!instance) return null;

    return this.deserialize(entityName, instance);
  }

  async insertEntity(
    entityName: string,
    id: string,
    instance: Record<string, unknown>
  ) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    // If `instance.id` is defined, replace it with the id passed as a parameter.
    // Should also log a warning here.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    instance.id = id;

    const pairs = getColumnValuePairs(instance);

    const insertValues = pairs.map(({ value }) => value);
    const insertFragment = `(${pairs
      .map(({ column }) => column)
      .join(", ")}) VALUES (${insertValues
      .map((_, idx) => `$${idx + 1}`)
      .join(", ")})`;

    const statement = `INSERT INTO "${entityName}" ${insertFragment} RETURNING *`;
    const insertedEntity = await this.db.oneOrNone(statement, insertValues);

    return this.deserialize(entityName, insertedEntity);
  }

  async updateEntity(
    entityName: string,
    id: string,
    instance: Record<string, unknown>
  ) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const pairs = getColumnValuePairs(instance);

    const updatePairs = pairs.filter(({ column }) => column !== "id");
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }, idx) => `${column} = $${idx + 1}`)
      .join(", ");

    const statement = `UPDATE "${entityName}" SET ${updateFragment} WHERE "id" = $${
      updatePairs.length + 1
    } RETURNING *`;
    updateValues.push(id);
    const updatedEntity = await this.db.oneOrNone(statement, updateValues);

    return this.deserialize(entityName, updatedEntity);
  }

  async upsertEntity(
    entityName: string,
    id: string,
    instance: Record<string, unknown>
  ) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    // If `instance.id` is defined, replace it with the id passed as a parameter.
    // Should also log a warning here.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    instance.id = id;

    const pairs = getColumnValuePairs(instance);

    const insertValues = pairs.map(({ value }) => value);
    const insertFragment = `(${pairs
      .map(({ column }) => column)
      .join(", ")}) VALUES (${insertValues
      .map((_, idx) => `$${idx + 1}`)
      .join(", ")})`;

    const updatePairs = pairs.filter(({ column }) => column !== "id");
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }, idx) => `${column} = $${idx + 1 + insertValues.length}`)
      .join(", ");

    const statement = `INSERT INTO "${entityName}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;
    const upsertedEntity = await this.db.oneOrNone(statement, [
      ...insertValues,
      ...updateValues,
    ]);

    return this.deserialize(entityName, upsertedEntity);
  }

  async deleteEntity(entityName: string, id: string): Promise<boolean> {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const statement = `DELETE FROM "${entityName}" WHERE "id" = $1`;

    const { rowCount } = await this.db.result(statement, [id]);

    // `rowCount` is equal to the number of rows that were updated/inserted/deleted by the query.
    return rowCount === 1;
  }

  async getEntities(entityName: string, filter?: EntityFilter) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const where = filter?.where;
    const first = filter?.first;
    const skip = filter?.skip;
    const orderBy = filter?.orderBy;
    const orderDirection = filter?.orderDirection;

    const fragments = [];

    if (where) {
      const whereFragments = Object.entries(where).map(([field, value]) => {
        const [fieldName, rawFilterType] = field.split(/_(.*)/s);
        // This is a hack to handle the "" operator, which the regex above doesn't handle
        const filterType = rawFilterType === undefined ? "" : rawFilterType;
        const sqlSymbols = sqlSymbolsForFilterType[filterType];
        if (!sqlSymbols) {
          throw new Error(
            `SQL operators not found for filter type: ${filterType}`
          );
        }

        const whereValue = getWhereValue(value, sqlSymbols);

        return `"${fieldName}" ${whereValue}`;
      });

      fragments.push(`WHERE ${whereFragments.join(" AND ")}`);
    }

    if (orderBy) {
      fragments.push(`ORDER BY "${orderBy}"`);
    }

    if (orderDirection) {
      fragments.push(`${orderDirection}`);
    }

    if (first) {
      fragments.push(`LIMIT ${first}`);
    }

    if (skip) {
      if (!first) {
        fragments.push(`LIMIT -1`); // Must add a no-op limit for SQLite to handle offset
      }
      fragments.push(`OFFSET ${skip}`);
    }

    const statement = `SELECT * FROM "${entityName}" ${fragments.join(" ")}`;
    const instances = await this.db.manyOrNone(statement);

    return instances.map((instance) => this.deserialize(entityName, instance));
  }

  async getEntityDerivedField(
    entityName: string,
    id: string,
    derivedFieldName: string
  ) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];
    if (!entity) {
      throw new Error(`Entity not found in schema: ${entityName}`);
    }

    const derivedField = entity.fields.find(
      (field): field is DerivedField =>
        field.kind === FieldKind.DERIVED && field.name === derivedFieldName
    );

    if (!derivedField) {
      throw new Error(
        `Derived field not found: ${entityName}.${derivedFieldName}`
      );
    }

    const derivedFieldInstances = await this.getEntities(
      derivedField.derivedFromEntityName,
      {
        where: {
          [derivedField.derivedFromFieldName]: id,
        },
      }
    );

    return derivedFieldInstances;
  }

  deserialize(entityName: string, instance: Record<string, unknown>) {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
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

      if (field.baseGqlType.toString() === "Boolean") {
        deserializedInstance[fieldName] = value === 1 ? true : false;
        return;
      }

      if (field.kind === FieldKind.LIST) {
        deserializedInstance[fieldName] = JSON.parse(value as string);
        return;
      }

      deserializedInstance[fieldName] = value;
    });

    return deserializedInstance as Record<string, unknown>;
  }
}
