import type { Pool } from "pg";

import type { Ponder } from "@/Ponder";
import { DerivedField, FieldKind, ScalarField, Schema } from "@/schema/types";

import type { EntityFilter, EntityStore } from "./entityStore";
import {
  getColumnValuePairs,
  getWhereValue,
  sqlSymbolsForFilterType,
} from "./utils";

export class PostgresEntityStore implements EntityStore {
  pool: Pool;
  ponder: Ponder;

  schema?: Schema;

  constructor({ pool, ponder }: { pool: Pool; ponder: Ponder }) {
    this.pool = pool;
    this.ponder = ponder;
  }

  errorWrapper = <T extends Array<any>, U>(fn: (...args: T) => U) => {
    return (...args: T): U => {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      // No need to wrap this in an error handler the way its done in
      // the SqliteEntityStore.
      return fn(...args);
    };
  };

  async migrate(schema?: Schema) {
    if (!schema) return;
    this.schema = schema;

    this.schema.entities.forEach(async (entity) => {
      // Drop the table if it already exists
      await this.pool.query(`DROP TABLE IF EXISTS "${entity.name}"`);

      // Build the create table statement using field migration fragments.
      // TODO: Update this so the generation of the field migration fragments happens here
      // instead of when the Schema gets built.
      const columnStatements = entity.fields
        .filter(
          // This type guard is wrong, could actually be any FieldKind that's not derived (obvs)
          (field): field is ScalarField => field.kind !== FieldKind.DERIVED
        )
        .map((field) => field.migrateUpStatement);

      await this.pool.query(
        `CREATE TABLE "${entity.name}" (${columnStatements.join(", ")})`
      );
    });
  }

  getEntity = this.errorWrapper(async (entityName: string, id: string) => {
    const statement = `SELECT "${entityName}".* FROM "${entityName}" WHERE "${entityName}"."id" = $1`;
    const { rows, rowCount } = await this.pool.query(statement, [id]);

    if (rowCount === 0) return null;
    return this.deserialize(entityName, rows[0]);
  });

  insertEntity = this.errorWrapper(
    async (
      entityName: string,
      id: string,
      instance: Record<string, unknown>
    ) => {
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
      const { rows } = await this.pool.query(statement, insertValues);

      return this.deserialize(entityName, rows[0]);
    }
  );

  updateEntity = this.errorWrapper(
    async (
      entityName: string,
      id: string,
      instance: Record<string, unknown>
    ) => {
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
      const { rows } = await this.pool.query(statement, updateValues);

      return this.deserialize(entityName, rows[0]);
    }
  );

  upsertEntity = this.errorWrapper(
    async (
      entityName: string,
      id: string,
      instance: Record<string, unknown>
    ) => {
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
        .map(
          ({ column }, idx) => `${column} = $${idx + 1 + insertValues.length}`
        )
        .join(", ");

      const statement = `INSERT INTO "${entityName}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;
      const { rows } = await this.pool.query(statement, [
        ...insertValues,
        ...updateValues,
      ]);

      return this.deserialize(entityName, rows[0]);
    }
  );

  deleteEntity = this.errorWrapper(async (entityName: string, id: string) => {
    const statement = `DELETE FROM "${entityName}" WHERE "id" = $1`;
    const { rowCount } = await this.pool.query(statement, [id]);

    return rowCount === 1;
  });

  getEntities = this.errorWrapper(
    async (entityName: string, filter?: EntityFilter) => {
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
      const { rows } = await this.pool.query(statement);

      return rows.map((instance) => this.deserialize(entityName, instance));
    }
  );

  getEntityDerivedField = this.errorWrapper(
    async (entityName: string, id: string, derivedFieldName: string) => {
      const entity = this.schema?.entityByName[entityName];
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
  );

  deserialize = (entityName: string, instance: Record<string, unknown>) => {
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
  };
}
