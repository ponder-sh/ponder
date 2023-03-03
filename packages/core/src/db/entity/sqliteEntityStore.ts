import type Sqlite from "better-sqlite3";

import { DerivedField, FieldKind, ScalarField, Schema } from "@/schema/types";

import { EntityFilter, EntityStore } from "./entityStore";
import {
  getColumnValuePairs,
  getWhereValue,
  sqlSymbolsForFilterType,
} from "./utils";

export class SqliteEntityStore implements EntityStore {
  db: Sqlite.Database;
  schema?: Schema;

  constructor({ db }: { db: Sqlite.Database }) {
    this.db = db;
  }

  teardown = () => {
    if (!this.schema) return;

    this.schema.entities.forEach((entity) => {
      this.db.prepare(`DROP TABLE IF EXISTS "${entity.id}"`).run();
    });
  };

  load = (newSchema?: Schema) => {
    if (!newSchema) return;

    // If there is an existing schema, this is a hot reload and the existing entity tables should be dropped.
    if (this.schema) {
      this.teardown();
    }

    this.schema = newSchema;

    this.schema.entities.forEach((entity) => {
      // Build the create table statement using field migration fragments.
      // TODO: Update this so the generation of the field migration fragments happens here
      // instead of when the Schema gets built.
      const columnStatements = entity.fields
        .filter(
          // This type guard is wrong, could actually be any FieldKind that's not derived (obvs)
          (field): field is ScalarField => field.kind !== FieldKind.DERIVED
        )
        .map((field) => field.migrateUpStatement);

      this.db
        .prepare(`CREATE TABLE "${entity.id}" (${columnStatements.join(", ")})`)
        .run();
    });
  };

  getEntity = (entityId: string, id: string) => {
    const statement = `SELECT "${entityId}".* FROM "${entityId}" WHERE "${entityId}"."id" = ?`;
    const instance = this.db.prepare(statement).get(id);

    if (!instance) return null;

    return this.deserialize(entityId, instance);
  };

  insertEntity = (
    entityId: string,
    id: string,
    instance: Record<string, unknown>
  ) => {
    // If `instance.id` is defined, replace it with the id passed as a parameter.
    // Should also log a warning here.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    instance.id = id;

    const pairs = getColumnValuePairs(instance);

    const insertValues = pairs.map((s) => s.value);
    const insertFragment = `(${pairs
      .map((s) => s.column)
      .join(", ")}) VALUES (${insertValues.map(() => "?").join(", ")})`;

    const statement = `INSERT INTO "${entityId}" ${insertFragment} RETURNING *`;

    const insertedEntity = this.db.prepare(statement).get(...insertValues);

    return this.deserialize(entityId, insertedEntity);
  };

  updateEntity = (
    entityId: string,
    id: string,
    instance: Record<string, unknown>
  ) => {
    const pairs = getColumnValuePairs(instance);

    const updatePairs = pairs.filter(({ column }) => column !== "id");
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }) => `${column} = ?`)
      .join(", ");

    const statement = `UPDATE "${entityId}" SET ${updateFragment} WHERE "id" = ? RETURNING *`;
    updateValues.push(`${id}`);

    const updatedEntity = this.db.prepare(statement).get(...updateValues);

    return this.deserialize(entityId, updatedEntity);
  };

  upsertEntity = (
    entityId: string,
    id: string,
    instance: Record<string, unknown>
  ) => {
    // If `instance.id` is defined, replace it with the id passed as a parameter.
    // Should also log a warning here.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    instance.id = id;

    const pairs = getColumnValuePairs(instance);

    const insertValues = pairs.map((s) => s.value);
    const insertFragment = `(${pairs
      .map((s) => s.column)
      .join(", ")}) VALUES (${insertValues.map(() => "?").join(", ")})`;

    const updatePairs = pairs.filter(({ column }) => column !== "id");
    const updateValues = updatePairs.map(({ value }) => value);
    const updateFragment = updatePairs
      .map(({ column }) => `${column} = ?`)
      .join(", ");

    const statement = `INSERT INTO "${entityId}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;

    const upsertedEntity = this.db
      .prepare(statement)
      .get(...insertValues, ...updateValues);

    return this.deserialize(entityId, upsertedEntity);
  };

  deleteEntity = (entityId: string, id: string) => {
    const statement = `DELETE FROM "${entityId}" WHERE "id" = ?`;

    const { changes } = this.db.prepare(statement).run(id);

    // `changes` is equal to the number of rows that were updated/inserted/deleted by the query.
    return changes === 1;
  };

  getEntities = (entityId: string, filter?: EntityFilter) => {
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

    const statement = `SELECT * FROM "${entityId}" ${fragments.join(" ")}`;

    const instances = this.db.prepare(statement).all();

    return instances.map((instance) => this.deserialize(entityId, instance));
  };

  getEntityDerivedField = (
    entityId: string,
    instanceId: string,
    derivedFieldName: string
  ) => {
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

    const derivedFieldInstances = this.getEntities(derivedFromEntity.id, {
      where: {
        [`${derivedField.derivedFromFieldName}`]: instanceId,
      },
    });

    return derivedFieldInstances;
  };

  deserialize = (entityId: string, instance: Record<string, unknown>) => {
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
