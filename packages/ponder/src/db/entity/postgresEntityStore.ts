import type PgPromise from "pg-promise";

import {
  DerivedField,
  FieldKind,
  PonderSchema,
  ScalarField,
} from "@/schema/types";

import { EntityFilter, EntityStore } from "./entityStore";
import { sqlOperatorsForFilterType } from "./utils";

export class PostgresEntityStore implements EntityStore {
  pgp: PgPromise.IMain;
  db: PgPromise.IDatabase<unknown>;
  schema?: PonderSchema;

  constructor(pgp: PgPromise.IMain, db: PgPromise.IDatabase<unknown>) {
    this.pgp = pgp;
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

  async getEntity<T>(entityName: string, id: string): Promise<T | null> {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];

    const statement = `
      SELECT "${entityName}".*
      FROM "${entityName}"
      WHERE "${entityName}"."id" = $(id)
    `;

    const rawEntityInstance = await this.db.oneOrNone(statement, {
      id: id,
    });

    if (!rawEntityInstance) {
      return null;
    }

    const deserializedEntityInstance = this.deserialize(
      entity.name,
      rawEntityInstance
    );

    return deserializedEntityInstance;
  }

  async getEntities<T>(
    entityName: string,
    filter?: EntityFilter
  ): Promise<T[]> {
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
          finalValue = `(${(finalValue as any[]).join(",")})`;
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

    const rawEntityInstances = await this.db.manyOrNone(statement);

    const entityInstances = rawEntityInstances.map((instance) =>
      this.deserialize(entityName, instance)
    );

    return entityInstances;
  }

  async insertEntity<T>(entityName: string, attributes: any): Promise<T> {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];

    const columnStatements = Object.entries(attributes).map(
      ([fieldName, value]) => {
        const field = entity.fieldByName[fieldName];
        return {
          column: `"${fieldName}"`,
          value: `'${value}'`,
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

  async updateEntity<T>(
    entityName: string,
    attributes: { id: string } & Partial<T>
  ): Promise<T> {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];

    const columnStatements = Object.entries(attributes).map(
      ([fieldName, value]) => {
        const field = entity.fieldByName[fieldName];
        return {
          column: `"${fieldName}"`,
          value: `'${value}'`,
        };
      }
    );

    const { id } = attributes;
    const updateFragment = columnStatements
      .filter((s) => s.column !== "id")
      .map((s) => `${s.column} = ${s.value}`)
      .join(", ");

    const statement = `UPDATE "${entityName}" SET ${updateFragment} WHERE "id" = $(id) RETURNING *`;
    const updatedEntity = await this.db.oneOrNone(statement, { id });

    return this.deserialize(entityName, updatedEntity);
  }

  async deleteEntity(entityName: string, id: string): Promise<void> {
    if (!this.schema) {
      throw new Error(`EntityStore has not been initialized with a schema yet`);
    }

    const statement = `DELETE FROM "${entityName}" WHERE "id" = $(id)`;

    await this.db.oneOrNone(statement, { id });
  }

  deserialize(entityName: string, instance: any) {
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
          [`${derivedField.derivedFromFieldName}`]: id,
        },
      }
    );

    return derivedFieldInstances;
  }
}
