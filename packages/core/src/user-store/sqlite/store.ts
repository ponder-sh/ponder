import type Sqlite from "better-sqlite3";
import { randomUUID } from "node:crypto";

import {
  Entity,
  EnumField,
  FieldKind,
  ListField,
  RelationshipField,
  ScalarField,
  Schema,
} from "@/schema/types";

import { EntityFilter, EntityInstance, UserStore } from "../store";
import {
  getColumnValuePairs,
  getWhereValue,
  sqlSymbolsForFilterType,
} from "../utils";

export class SqliteUserStore implements UserStore {
  db: Sqlite.Database;
  schema?: Schema;
  instanceId?: string;

  constructor({ db }: { db: Sqlite.Database }) {
    this.db = db;
  }

  load({ schema: newSchema }: { schema: Schema }) {
    if (this.schema) {
      this.schema.entities.forEach((entity) => {
        this.db
          .prepare(`DROP TABLE IF EXISTS "${entity.name}_${this.instanceId}"`)
          .run();
      });
    }

    this.instanceId = randomUUID();

    for (const entity of newSchema.entities) {
      const createTableStatement = this.getCreateTableStatement(entity);
      this.db.prepare(createTableStatement).run();
    }

    this.schema = newSchema;
  }

  reset() {
    if (!this.schema) return;

    for (const entity of this.schema.entities) {
      this.db
        .prepare(`DROP TABLE IF EXISTS "${entity.name}_${this.instanceId}"`)
        .run();
    }

    this.instanceId = randomUUID();

    for (const entity of this.schema.entities) {
      const createTableStatement = this.getCreateTableStatement(entity);
      this.db.prepare(createTableStatement).run();
    }
  }

  teardown() {
    if (!this.schema) return;

    for (const entity of this.schema.entities) {
      this.db
        .prepare(`DROP TABLE IF EXISTS "${entity.name}_${this.instanceId}"`)
        .run();
    }
  }

  private getCreateTableStatement(entity: Entity) {
    const gqlScalarToSqlType: Record<string, string | undefined> = {
      Boolean: "integer",
      Int: "integer",
      String: "text",
      BigInt: "text",
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
    id: string | number | bigint;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const statement = `SELECT "${tableName}".* FROM "${tableName}" WHERE "${tableName}"."id" = ?`;
    const instance = this.db.prepare(statement).get(id);

    if (!instance) return null;

    return this.deserialize({ entityName, instance });
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
    const insertValues = pairs.map((s) => s.value);
    const insertFragment = `(${pairs
      .map((s) => s.column)
      .join(", ")}) VALUES (${insertValues.map(() => "?").join(", ")})`;

    const statement = `INSERT INTO "${tableName}" ${insertFragment} RETURNING *`;

    const insertedEntity = this.db.prepare(statement).get(...insertValues);

    return this.deserialize({ entityName, instance: insertedEntity });
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

    const updatePairs = pairs.filter(({ column }) => column !== "id");
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }) => `${column} = ?`)
      .join(", ");

    const statement = `UPDATE "${tableName}" SET ${updateFragment} WHERE "id" = ? RETURNING *`;
    updateValues.push(`${id}`);

    const updatedEntity = this.db.prepare(statement).get(...updateValues);

    return this.deserialize({ entityName, instance: updatedEntity });
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

    // Add the passed `id` to the create object.
    const insertPairs = getColumnValuePairs({ ...create, id });
    const insertValues = insertPairs.map((s) => s.value);
    const insertFragment = `(${insertPairs
      .map((s) => s.column)
      .join(", ")}) VALUES (${insertValues.map(() => "?").join(", ")})`;

    const updatePairs = getColumnValuePairs({ ...update, id });
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }) => `${column} = ?`)
      .join(", ");

    const statement = `INSERT INTO "${tableName}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;

    const upsertedEntity = this.db
      .prepare(statement)
      .get(...insertValues, ...updateValues);

    return this.deserialize({ entityName, instance: upsertedEntity });
  };

  deleteEntity = async ({
    entityName,
    id,
  }: {
    entityName: string;
    id: string;
  }) => {
    const tableName = `${entityName}_${this.instanceId}`;

    const statement = `DELETE FROM "${tableName}" WHERE "id" = ?`;

    const { changes } = this.db.prepare(statement).run(id);

    // `changes` is equal to the number of rows that were updated/inserted/deleted by the query.
    return changes === 1;
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
      const entity = this.schema?.entities.find((e) => e.name === entityName);
      const orderByField = entity?.fieldByName[orderBy] as ScalarField;
      // Bigints are stored as strings in SQLite. This means when trying to
      // order by a bigint field, the values are sorted as strings. This
      // fixes the issue by casting them as REAL for the purposes of sorting.
      if (orderByField.scalarTypeName === "BigInt") {
        fragments.push(`ORDER BY CAST("${orderBy}" AS REAL)`);
      } else {
        fragments.push(`ORDER BY "${orderBy}"`);
      }
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

    const statement = `SELECT * FROM "${tableName}" ${fragments.join(" ")}`;

    const instances = this.db.prepare(statement).all();

    return instances.map((instance) =>
      this.deserialize({ entityName, instance })
    );
  };

  deserialize = ({
    entityName,
    instance,
  }: {
    entityName: string;
    instance: Record<string, unknown>;
  }) => {
    const entity = this.schema?.entities.find((e) => e.name === entityName);
    if (!entity) {
      throw new Error(`Entity not found in schema with name: ${entityName}`);
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
