import type Sqlite from "better-sqlite3";

import {
  DerivedField,
  FieldKind,
  PonderSchema,
  ScalarField,
} from "@/core/schema/types";

import { BaseEntityStore, EntityFilter, StoreKind } from "./baseEntityStore";

export class SqliteEntityStore implements BaseEntityStore {
  kind = StoreKind.SQLITE;
  db: Sqlite.Database;
  schema?: PonderSchema;

  constructor(db: Sqlite.Database) {
    this.db = db;
  }

  async migrate(schema: PonderSchema) {
    schema.entities.forEach((entity) => {
      // Drop the table if it already exists
      this.db.prepare(`drop table if exists \`${entity.name}\``).run();

      // Build the create table statement using field migration fragments.
      // TODO: Update this so the generation of the field migration fragments happens here
      // instead of when the PonderSchema gets built.
      const columnStatements = entity.fields
        .filter(
          // This type guard is wrong, could actually be any FieldKind that's not derived (obvs)
          (field): field is ScalarField => field.kind !== FieldKind.DERIVED
        )
        .map((field) => field.migrateUpStatement);

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

    const statement = `
      select \`${entityName}\`.*
      from \`${entityName}\`
      where \`${entityName}\`.\`id\` = @id
    `;

    const rawEntityInstance = this.db.prepare(statement).get({
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
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
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

        whereFragments.push(`\`${fieldName}\` ${operator} ${finalValue}`);
      }

      fragments.push(`where ${whereFragments.join(" and ")}`);
    }

    if (orderBy) {
      fragments.push(`order by \`${orderBy}\``);
    }

    if (orderDirection) {
      fragments.push(`${orderDirection}`);
    }

    if (first) {
      fragments.push(`limit ${first}`);
    }

    if (skip) {
      if (!first) {
        fragments.push(`limit -1`); // Must add a no-op limit for SQLite to handle offset
      }
      fragments.push(`offset ${skip}`);
    }

    const statement = `select * from \`${entityName}\` ${fragments.join(" ")}`;

    const rawEntityInstances = this.db.prepare(statement).all();

    const entityInstances = rawEntityInstances.map((instance) =>
      this.deserialize(entityName, instance)
    );

    return entityInstances;
  }

  async insertEntity<T>(entityName: string, attributes: any): Promise<T> {
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

    return this.deserialize(entityName, insertedEntity);
  }

  async updateEntity<T>(
    entityName: string,
    attributes: { id: string } & any
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

    const { id } = attributes;
    const updateFragment = columnStatements
      .filter((s) => s.column !== "id")
      .map((s) => `${s.column} = ${s.value}`)
      .join(", ");

    const statement = `update \`${entityName}\` set ${updateFragment} where \`id\` = @id returning *`;
    const updatedEntity = this.db.prepare(statement).get({ id: id });

    return this.deserialize(entityName, updatedEntity);
  }

  async deleteEntity(entityName: string, id: string): Promise<void> {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const statement = `delete from \`${entityName}\` where \`id\` = @id`;

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

  async getEntityDerivedField(
    entityName: string,
    id: string,
    derivedFieldName: string
  ) {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
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

const sqlOperatorsForFilterType: Record<
  string,
  | {
      operator: string;
      isList?: boolean;
      patternPrefix?: string;
      patternSuffix?: string;
    }
  | undefined
> = {
  // universal
  "": { operator: "=" },
  not: { operator: "!=" },
  // singular
  in: { operator: "in", isList: true },
  not_in: { operator: "not in", isList: true },
  // plural
  contains: { operator: "like", patternPrefix: "%", patternSuffix: "%" },
  contains_nocase: {
    operator: "like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  not_contains: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  not_contains_nocase: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  // numeric
  gt: { operator: ">" },
  lt: { operator: "<" },
  gte: { operator: ">=" },
  lte: { operator: "<=" },
  // string
  starts_with: { operator: "like", patternSuffix: "%" },
  starts_with_nocase: { operator: "like", patternSuffix: "%" },
  ends_with: { operator: "like", patternPrefix: "%" },
  ends_with_nocase: { operator: "like", patternPrefix: "%" },
  not_starts_with: { operator: "not like", patternSuffix: "%" },
  not_starts_with_nocase: { operator: "not like", patternSuffix: "%" },
  not_ends_with: { operator: "not like", patternSuffix: "%" },
  not_ends_with_nocase: { operator: "not like", patternSuffix: "%" },
};
