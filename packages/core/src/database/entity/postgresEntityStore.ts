import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import {
  Entity,
  EnumField,
  FieldKind,
  ListField,
  RelationshipField,
  ScalarField,
  Schema,
} from "@/schema/types";

import type { EntityFilter, EntityInstance, EntityStore } from "./entityStore";
import {
  getColumnValuePairs,
  getWhereValue,
  sqlSymbolsForFilterType,
} from "./utils";

export class PostgresEntityStore implements EntityStore {
  pool: Pool;
  schema?: Schema;
  instanceId?: string;

  constructor({ pool }: { pool: Pool }) {
    this.pool = pool;
  }

  async load({ schema: newSchema }: { schema: Schema }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (this.schema) {
        for (const entity of this.schema.entities) {
          await client.query(
            `DROP TABLE IF EXISTS "${entity.name}_${this.instanceId}"`
          );
        }
      }

      this.instanceId = randomUUID();

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
        await client.query(
          `DROP TABLE IF EXISTS "${entity.name}_${this.instanceId}"`
        );
      }

      this.instanceId = randomUUID();

      for (const entity of this.schema.entities) {
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
        await client.query(
          `DROP TABLE IF EXISTS "${entity.name}_${this.instanceId}"`
        );
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
      BigInt: "numeric(78)", // Store BigInts as numerics large enough for Solidity's MAX_INT (2**256 - 1).
      Bytes: "text",
      Float: "text",
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
          case FieldKind.LIST: {
            const notNull = field.notNull ? "NOT NULL" : "";
            return `"${field.name}" TEXT ${notNull}`;
          }
          case FieldKind.RELATIONSHIP: {
            const type = gqlScalarToSqlType[field.relatedEntityIdType.name];
            const notNull = field.notNull ? "NOT NULL" : "";
            return `"${field.name}" ${type} ${notNull}`;
          }
        }
      });

    const tableName = `${entity.name}_${this.instanceId}`;
    return `CREATE TABLE "${tableName}" (${columnStatements.join(", ")})`;
  }

  findUniqueEntity = async ({
    entityName,
    id,
  }: {
    entityName: string;
    id: string;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const statement = `SELECT "${tableName}".* FROM "${tableName}" WHERE "${tableName}"."id" = $1`;
    const { rows, rowCount } = await this.pool.query(statement, [id]);

    if (rowCount === 0) return null;
    return this.deserialize({ entityName, instance: rows[0] });
  };

  createEntity = async ({
    entityName,
    id,
    data,
  }: {
    entityName: string;
    id: string | number | bigint;
    data: Record<string, unknown>;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const pairs = getColumnValuePairs({ ...data, id });
    const insertValues = pairs.map(({ value }) => value);
    const insertFragment = `(${pairs
      .map(({ column }) => column)
      .join(", ")}) VALUES (${insertValues
      .map((_, idx) => `$${idx + 1}`)
      .join(", ")})`;

    const statement = `INSERT INTO "${tableName}" ${insertFragment} RETURNING *`;
    const { rows } = await this.pool.query(statement, insertValues);

    return this.deserialize({ entityName, instance: rows[0] });
  };

  updateEntity = async ({
    entityName,
    id,
    data,
  }: {
    entityName: string;
    id: string | number | bigint;
    data: Record<string, unknown>;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const pairs = getColumnValuePairs(data);
    const updateValues = pairs.map(({ value }) => value);
    const updateFragment = pairs
      .map(({ column }, idx) => `${column} = $${idx + 1}`)
      .join(", ");

    const statement = `UPDATE "${tableName}" SET ${updateFragment} WHERE "id" = $${
      pairs.length + 1
    } RETURNING *`;
    updateValues.push(id.toString());

    const { rows } = await this.pool.query(statement, updateValues);

    return this.deserialize({ entityName, instance: rows[0] });
  };

  upsertEntity = async ({
    entityName,
    id,
    create,
    update,
  }: {
    entityName: string;
    id: string | number | bigint;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const insertPairs = getColumnValuePairs({ ...create, id });
    const insertValues = insertPairs.map(({ value }) => value);
    const insertFragment = `(${insertPairs
      .map(({ column }) => column)
      .join(", ")}) VALUES (${insertValues
      .map((_, idx) => `$${idx + 1}`)
      .join(", ")})`;

    const updatePairs = getColumnValuePairs({ ...update, id });
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }, idx) => `${column} = $${idx + 1 + insertValues.length}`)
      .join(", ");

    const statement = `INSERT INTO "${tableName}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;
    const { rows } = await this.pool.query(statement, [
      ...insertValues,
      ...updateValues,
    ]);

    return this.deserialize({ entityName, instance: rows[0] });
  };

  deleteEntity = async ({
    entityName,
    id,
  }: {
    entityName: string;
    id: string | number | bigint;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const statement = `DELETE FROM "${tableName}" WHERE "id" = $1`;
    const { rowCount } = await this.pool.query(statement, [id]);

    return rowCount === 1;
  };

  getEntities = async ({
    entityName,
    filter,
  }: {
    entityName: string;
    filter?: EntityFilter;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

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

    const statement = `SELECT * FROM "${tableName}" ${fragments.join(" ")}`;
    const { rows } = await this.pool.query(statement);

    return rows.map((instance) => this.deserialize({ entityName, instance }));
  };

  deserialize = ({
    entityName,
    instance,
  }: {
    entityName: string;
    instance: Record<string, unknown>;
  }) => {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const entity = this.schema?.entities.find((e) => e.name === entityName);
    if (!entity) {
      throw new Error(`Entity not found in schema for ID: ${entityName}`);
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

    return deserializedInstance as EntityInstance;
  };
}
