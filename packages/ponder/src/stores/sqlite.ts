import Sqlite from "better-sqlite3";

import { logger } from "@/common/logger";
import { FieldKind, PonderSchema } from "@/core/schema/types";

import { BaseStore, EntityFilter, StoreKind } from "./base";

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

    const instance = this.populateRelatedEntities(
      entity.name,
      deserializedEntityInstance
    );

    return instance;
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
      console.log({ where });

      const whereFragments: string[] = [];

      for (const [field, value] of Object.entries(where)) {
        const [fieldName, rawFilterType] = field.split(/_(.*)/s);

        // This is a hack to handle the = operator, which the regex above doesn't handle
        const filterType = rawFilterType === undefined ? "" : rawFilterType;

        console.log({ fieldName, filterType });

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

        console.log({ finalValue });

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

    console.log({ statement });

    const rawEntityInstances = this.db.prepare(statement).all();

    const instances = rawEntityInstances.map((instance) => {
      return this.populateRelatedEntities(
        entityName,
        this.deserialize(entityName, instance)
      );
    });

    return instances;
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

  populateRelatedEntities(entityName: string, instance: any) {
    if (!this.schema) {
      throw new Error(`SqliteStore has not been initialized with a schema yet`);
    }

    const entity = this.schema.entityByName[entityName];
    if (!entity) {
      throw new Error(`Entity not found in schema: ${entityName}`);
    }

    const populatedInstance = { ...instance };

    // This is pretty terrible for performance, should be doing a join here
    entity.fields.forEach(async (field) => {
      if (field.kind !== FieldKind.RELATIONSHIP) return;

      const id = populatedInstance[field.name];
      populatedInstance[field.name] = await this.getEntity(
        field.baseGqlType.name,
        id
      );
    });

    return populatedInstance;
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
