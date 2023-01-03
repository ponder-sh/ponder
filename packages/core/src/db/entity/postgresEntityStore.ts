import type PgPromise from "pg-promise";

import {
  DerivedField,
  FieldKind,
  PonderSchema,
  ScalarField,
} from "@/schema/types";

import type { EntityFilter, EntityStore } from "./entityStore";
import { sqlOperatorsForFilterType } from "./utils";

export class PostgresEntityStore implements EntityStore {
  db: PgPromise.IDatabase<unknown>;
  schema?: PonderSchema;

  constructor({ db }: { db: PgPromise.IDatabase<unknown> }) {
    this.db = db;
  }

  async migrate(schema: PonderSchema) {
    this.schema = schema;

    schema.entities.forEach(async (entity) => {
      // Drop the table if it already exists
      await this.db.none(`DROP TABLE IF EXISTS "${entity.name}"`);

      // Build the create table statement using field migration fragments.
      // TODO: Update this so the generation of the field migration fragments happens here
      // instead of when the PonderSchema gets built.
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

    const statement = `SELECT "${entityName}".* FROM "${entityName}" WHERE "${entityName}"."id" = $(id)`;
    const instance = await this.db.oneOrNone(statement, { id });

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

    const columnStatements = Object.entries(instance).map(
      ([fieldName, value]) => {
        const persistedValue =
          typeof value === "boolean" ? (value ? 1 : 0) : `'${value}'`;

        return {
          column: `"${fieldName}"`,
          value: persistedValue,
        };
      }
    );

    const insertFragment = `(${columnStatements
      .map((s) => s.column)
      .join(", ")}) VALUES (${columnStatements
      .map((s) => s.value)
      .join(", ")})`;

    const statement = `INSERT INTO "${entityName}" ${insertFragment} RETURNING *`;
    const insertedEntity = await this.db.oneOrNone(statement);

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

    const columnStatements = Object.entries(instance).map(
      ([fieldName, value]) => {
        const persistedValue =
          typeof value === "boolean" ? (value ? 1 : 0) : `'${value}'`;

        return {
          column: `"${fieldName}"`,
          value: persistedValue,
        };
      }
    );

    const updateFragment = columnStatements
      .filter(({ column }) => column !== "id") // Ignore `instance.id` field for update fragment
      .map(({ column, value }) => `${column} = ${value}`)
      .join(", ");

    const statement = `UPDATE "${entityName}" SET ${updateFragment} WHERE "id" = $(id) RETURNING *`;
    const updatedEntity = await this.db.oneOrNone(statement, { id });

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

    const columnStatements = Object.entries(instance).map(
      ([fieldName, value]) => {
        const persistedValue =
          typeof value === "boolean" ? (value ? 1 : 0) : `'${value}'`;

        return {
          column: `"${fieldName}"`,
          value: persistedValue,
        };
      }
    );

    const insertFragment = `(${columnStatements
      .map((s) => s.column)
      .join(", ")}) VALUES (${columnStatements
      .map((s) => s.value)
      .join(", ")})`;

    const updateFragment = columnStatements
      .filter(({ column }) => column !== "id") // Ignore `instance.id` field for update fragment
      .map(({ column, value }) => `${column} = ${value}`)
      .join(", ");

    const statement = `INSERT INTO "${entityName}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;
    const upsertedEntity = await this.db.oneOrNone(statement, { id });

    return this.deserialize(entityName, upsertedEntity);
  }

  async deleteEntity(entityName: string, id: string): Promise<boolean> {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const statement = `DELETE FROM "${entityName}" WHERE "id" = $(id)`;

    const { rowCount } = await this.db.result(statement, { id });

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
      const whereFragments: string[] = [];

      for (const [field, value] of Object.entries(where)) {
        const [fieldName, rawFilterType] = field.split(/_(.*)/s);

        // This is a hack to handle the = operator, which the regex above doesn't handle
        const filterType = rawFilterType === undefined ? "" : rawFilterType;

        const sqlOperators = sqlOperatorsForFilterType[filterType];
        if (!sqlOperators) {
          throw new Error(
            `SQL operators not found for filter type: ${filterType}`
          );
        }

        const { operator, patternPrefix, patternSuffix, isList } = sqlOperators;

        let finalValue = value;

        if (patternPrefix) finalValue = patternPrefix + finalValue;
        if (patternSuffix) finalValue = finalValue + patternSuffix;

        if (isList) {
          finalValue = `(${(finalValue as (string | number)[]).join(",")})`;
        } else {
          finalValue = `'${finalValue}'`;
        }

        whereFragments.push(`"${fieldName}" ${operator} ${finalValue}`);
      }

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
        deserializedInstance[fieldName] = (value as string).split(",");
        return;
      }

      deserializedInstance[fieldName] = value;
    });

    return deserializedInstance as Record<string, unknown>;
  }
}
