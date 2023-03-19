import type { Pool } from "pg";

import {
  DerivedField,
  Entity,
  EnumField,
  FieldKind,
  ListField,
  RelationshipField,
  ScalarField,
  Schema,
} from "@/schema/types";

import type { EntityFilter, EntityStore } from "./entityStore";
import {
  getColumnValuePairs,
  getWhereValue,
  sqlSymbolsForFilterType,
} from "./utils";

export class PostgresEntityStore implements EntityStore {
  pool: Pool;
  schema?: Schema;

  constructor({ pool }: { pool: Pool }) {
    this.pool = pool;
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

  async load(newSchema: Schema) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (this.schema) {
        for (const entity of this.schema.entities) {
          await client.query(`DROP TABLE IF EXISTS "${entity.id}"`);
        }
      }

      for (const entity of newSchema.entities) {
        const createTableStatement = this.getCreateTableStatement(entity);
        await client.query(createTableStatement);
      }

      await client.query("COMMIT");
      this.schema = newSchema;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reset() {
    if (!this.schema) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entity of this.schema.entities) {
        await client.query(`DROP TABLE IF EXISTS "${entity.id}"`);

        const createTableStatement = this.getCreateTableStatement(entity);
        await client.query(createTableStatement);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async teardown() {
    if (!this.schema) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entity of this.schema.entities) {
        await client.query(`DROP TABLE IF EXISTS "${entity.id}"`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private getCreateTableStatement(entity: Entity) {
    const gqlScalarToSqlType: Record<string, string | undefined> = {
      Boolean: "integer",
      Int: "integer",
      String: "text",
      BigInt: "text",
      BigDecimal: "text",
      Bytes: "text",
    };

    const columnStatements = entity.fields
      .filter(
        (
          field
        ): field is RelationshipField | ScalarField | ListField | EnumField =>
          field.kind !== FieldKind.DERIVED
      )
      .map((field) => {
        switch (field.kind) {
          case FieldKind.SCALAR: {
            const type = gqlScalarToSqlType[field.scalarTypeName];
            const notNull = field.notNull ? "NOT NULL" : "";
            const pk = field.name === "id" ? "PRIMARY KEY" : "";
            return `"${field.name}" ${type} ${notNull} ${pk}`;
          }
          case FieldKind.ENUM: {
            const notNull = field.notNull ? "NOT NULL" : "";

            return `"${field.name}" TEXT CHECK ("${
              field.name
            }" IN (${field.enumValues
              .map((v) => `'${v}'`)
              .join(", ")})) ${notNull}`;
          }
          default: {
            return field.migrateUpStatement;
          }
        }
      });

    return `CREATE TABLE "${entity.id}" (${columnStatements.join(", ")})`;
  }

  getEntity = this.errorWrapper(async (entityId: string, id: string) => {
    const statement = `SELECT "${entityId}".* FROM "${entityId}" WHERE "${entityId}"."id" = $1`;
    const { rows, rowCount } = await this.pool.query(statement, [id]);

    if (rowCount === 0) return null;
    return this.deserialize(entityId, rows[0]);
  });

  insertEntity = this.errorWrapper(
    async (entityId: string, id: string, instance: Record<string, unknown>) => {
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

      const statement = `INSERT INTO "${entityId}" ${insertFragment} RETURNING *`;
      const { rows } = await this.pool.query(statement, insertValues);

      return this.deserialize(entityId, rows[0]);
    }
  );

  updateEntity = this.errorWrapper(
    async (entityId: string, id: string, instance: Record<string, unknown>) => {
      const pairs = getColumnValuePairs(instance);

      const updatePairs = pairs.filter(({ column }) => column !== "id");
      const updateValues = updatePairs.map(({ value }) => value);
      const updateFragment = updatePairs
        .map(({ column }, idx) => `${column} = $${idx + 1}`)
        .join(", ");

      const statement = `UPDATE "${entityId}" SET ${updateFragment} WHERE "id" = $${
        updatePairs.length + 1
      } RETURNING *`;
      updateValues.push(id);
      const { rows } = await this.pool.query(statement, updateValues);

      return this.deserialize(entityId, rows[0]);
    }
  );

  upsertEntity = this.errorWrapper(
    async (entityId: string, id: string, instance: Record<string, unknown>) => {
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

      const statement = `INSERT INTO "${entityId}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;
      const { rows } = await this.pool.query(statement, [
        ...insertValues,
        ...updateValues,
      ]);

      return this.deserialize(entityId, rows[0]);
    }
  );

  deleteEntity = this.errorWrapper(async (entityId: string, id: string) => {
    const statement = `DELETE FROM "${entityId}" WHERE "id" = $1`;
    const { rowCount } = await this.pool.query(statement, [id]);

    return rowCount === 1;
  });

  getEntities = this.errorWrapper(
    async (entityId: string, filter?: EntityFilter) => {
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
        fragments.push(`OFFSET ${skip}`);
      }

      const statement = `SELECT * FROM "${entityId}" ${fragments.join(" ")}`;
      const { rows } = await this.pool.query(statement);

      return rows.map((instance) => this.deserialize(entityId, instance));
    }
  );

  getEntityDerivedField = this.errorWrapper(
    async (entityId: string, instanceId: string, derivedFieldName: string) => {
      const entity = this.schema?.entities.find((e) => e.id === entityId);
      if (!entity) {
        throw new Error(`Entity not found in schema for ID: ${entityId}`);
      }

      const derivedField = entity.fields.find(
        (field): field is DerivedField =>
          field.kind === FieldKind.DERIVED && field.name === derivedFieldName
      );

      if (!derivedField) {
        throw new Error(
          `Derived field not found: ${entity.name}.${derivedFieldName}`
        );
      }

      const derivedFromEntity = this.schema?.entities.find(
        (e) => e.name === derivedField.derivedFromEntityName
      );
      if (!derivedFromEntity) {
        throw new Error(
          `Entity not found in schema for name: ${derivedField.derivedFromEntityName}`
        );
      }

      const derivedFieldInstances = await this.getEntities(
        derivedFromEntity.id,
        {
          where: {
            [derivedField.derivedFromFieldName]: instanceId,
          },
        }
      );

      return derivedFieldInstances;
    }
  );

  deserialize = (entityId: string, instance: Record<string, unknown>) => {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const entity = this.schema?.entities.find((e) => e.id === entityId);
    if (!entity) {
      throw new Error(`Entity not found in schema for ID: ${entityId}`);
    }

    const deserializedInstance = { ...instance };

    // For each property on the instance, look for a field defined on the entity
    // with the same name and apply any required deserialization transforms.
    Object.entries(instance).forEach(([fieldName, value]) => {
      const field = entity.fieldByName[fieldName];
      if (!field) return;

      switch (field.kind) {
        case FieldKind.SCALAR: {
          if (field.scalarTypeName === "Boolean") {
            deserializedInstance[fieldName] = value === 1 ? true : false;
          } else {
            deserializedInstance[fieldName] = value;
          }
          break;
        }
        case FieldKind.LIST: {
          deserializedInstance[fieldName] = JSON.parse(value as string);
          break;
        }
        default: {
          deserializedInstance[fieldName] = value;
        }
      }
    });

    return deserializedInstance as Record<string, unknown>;
  };
}
