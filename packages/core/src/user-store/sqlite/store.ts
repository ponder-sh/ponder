import type Sqlite from "better-sqlite3";
import { randomBytes } from "crypto";
import { Kysely, sql, SqliteDialect } from "kysely";

import { type Schema, FieldKind } from "@/schema/types";
import { blobToBigInt } from "@/utils/decode";

import type { ModelFilter, ModelInstance, UserStore } from "../store";
import {
  type FilterType,
  formatModelFieldValue,
  formatModelInstance,
  getWhereOperatorAndValue,
} from "../utils";

const gqlScalarToSqlType = {
  Boolean: "integer",
  Int: "integer",
  String: "text",
  BigInt: "blob",
  Bytes: "text",
  Float: "text",
} as const;

export class SqliteUserStore implements UserStore {
  db: Kysely<any>;

  schema?: Schema;
  private versionId?: string;

  constructor({ db }: { db: Sqlite.Database }) {
    this.db = new Kysely({
      dialect: new SqliteDialect({ database: db }),
    });
  }

  /**
   * Resets the database by dropping existing tables and creating new tables.
   * If no new schema is provided, the existing schema is used.
   *
   * @param options.schema New schema to be used.
   */
  reload = async ({ schema }: { schema?: Schema } = {}) => {
    // If there is no existing schema and no schema was provided, do nothing.
    if (!this.schema && !schema) return;

    await this.db.transaction().execute(async (tx) => {
      // Drop tables from existing schema.
      if (this.schema) {
        await Promise.all(
          this.schema.entities.map((model) => {
            const tableName = `${model.name}_${this.versionId}`;
            tx.schema.dropTable(tableName);
          })
        );
      }

      if (schema) this.schema = schema;

      this.versionId = randomBytes(4).toString("hex");

      // Create tables for new schema.
      await Promise.all(
        this.schema!.entities.map(async (model) => {
          const tableName = `${model.name}_${this.versionId}`;
          let tableBuilder = tx.schema.createTable(tableName);
          model.fields.forEach((field) => {
            switch (field.kind) {
              case FieldKind.SCALAR: {
                tableBuilder = tableBuilder.addColumn(
                  field.name,
                  gqlScalarToSqlType[field.scalarTypeName],
                  (col) => {
                    if (field.notNull) col = col.notNull();
                    if (field.name === "id") col = col.primaryKey();
                    return col;
                  }
                );
                break;
              }
              case FieldKind.ENUM: {
                tableBuilder = tableBuilder.addColumn(
                  field.name,
                  "text",
                  (col) => {
                    if (field.notNull) col = col.notNull();
                    col = col.check(
                      sql`${sql.ref(field.name)} in (${sql.join(
                        field.enumValues.map((v) => sql.lit(v))
                      )})`
                    );
                    return col;
                  }
                );
                break;
              }
              case FieldKind.LIST: {
                tableBuilder = tableBuilder.addColumn(
                  field.name,
                  "text",
                  (col) => {
                    if (field.notNull) col = col.notNull();
                    return col;
                  }
                );
                break;
              }
              case FieldKind.RELATIONSHIP: {
                tableBuilder = tableBuilder.addColumn(
                  field.name,
                  gqlScalarToSqlType[field.relatedEntityIdTypeName],
                  (col) => {
                    if (field.notNull) col = col.notNull();
                    return col;
                  }
                );
                break;
              }
            }
          });

          await tableBuilder.execute();
        })
      );
    });
  };

  /**
   * Tears down the store by dropping all tables for the current schema.
   */
  teardown = async () => {
    if (!this.schema) return;

    // Drop tables from existing schema.
    await this.db.transaction().execute(async (tx) => {
      await Promise.all(
        this.schema!.entities.map((model) => {
          const tableName = `${model.name}_${this.versionId}`;
          tx.schema.dropTable(tableName);
        })
      );
    });
  };

  findUnique = async ({
    modelName,
    id,
  }: {
    modelName: string;
    id: string | number | bigint;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const instance = await this.db
      .selectFrom(tableName)
      .selectAll()
      .where("id", "=", formatModelFieldValue({ value: id }))
      .executeTakeFirst();

    return instance ? this.deserializeInstance({ modelName, instance }) : null;
  };

  create = async ({
    modelName,
    id,
    data = {},
  }: {
    modelName: string;
    id: string | number | bigint;
    data?: Omit<ModelInstance, "id">;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedInstance = formatModelInstance({ id, data });

    const instance = await this.db
      .insertInto(tableName)
      .values(formattedInstance)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.deserializeInstance({ modelName, instance });
  };

  update = async ({
    modelName,
    id,
    data = {},
  }: {
    modelName: string;
    id: string | number | bigint;
    data?: Partial<Omit<ModelInstance, "id">>;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedInstance = formatModelInstance({ id, data });

    const instance = await this.db
      .updateTable(tableName)
      .set(formattedInstance)
      .where("id", "=", formattedInstance.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.deserializeInstance({ modelName, instance });
  };

  upsert = async ({
    modelName,
    id,
    create = {},
    update = {},
  }: {
    modelName: string;
    id: string | number | bigint;
    create?: Omit<ModelInstance, "id">;
    update?: Partial<Omit<ModelInstance, "id">>;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const createInstance = formatModelInstance({ id, data: create });
    const updateInstance = formatModelInstance({ id, data: update });

    const instance = await this.db
      .insertInto(tableName)
      .values(createInstance)
      .onConflict((oc) => oc.column("id").doUpdateSet(updateInstance))
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.deserializeInstance({ modelName, instance });
  };

  delete = async ({
    modelName,
    id,
  }: {
    modelName: string;
    id: string | number | bigint;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });

    const instance = await this.db
      .deleteFrom(tableName)
      .where("id", "=", formattedId)
      .returningAll()
      .executeTakeFirst();

    return !!instance;
  };

  findMany = async ({
    modelName,
    filter = {},
  }: {
    modelName: string;
    filter?: ModelFilter;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;

    let query = this.db.selectFrom(tableName).selectAll();

    const { where, first, skip, orderBy, orderDirection } = filter;

    if (where) {
      Object.entries(where).forEach(([whereKey, rawValue]) => {
        const [fieldName, rawFilterType] = whereKey.split(/_(.*)/s);
        // This is a hack to handle the "" operator, which the regex above doesn't handle
        const filterType = (
          rawFilterType === undefined ? "" : rawFilterType
        ) as FilterType;

        const { operator, value } = getWhereOperatorAndValue({
          filterType,
          value: rawValue,
        });

        query = query.where(fieldName, operator, value);
      });
    }

    if (skip) {
      query = query.offset(skip);
      // SQLite doesn't support OFFSET without LIMIT, so we need to set a limit.
      if (!first) query = query.limit(-1);
    }
    if (first) {
      query = query.limit(first);
    }
    if (orderBy) {
      query = query.orderBy(orderBy, orderDirection);
    }

    const instances = await query.execute();

    return instances.map((instance) =>
      this.deserializeInstance({ modelName, instance })
    );
  };

  private deserializeInstance = ({
    modelName,
    instance,
  }: {
    modelName: string;
    instance: Record<string, unknown>;
  }) => {
    const entity = this.schema!.entities.find((e) => e.name === modelName)!;

    const deserializedInstance = {} as ModelInstance;

    entity.fields.forEach((field) => {
      const value = instance[field.name] as string | number | null | undefined;

      if (value === null || value === undefined) {
        deserializedInstance[field.name] = null;
        return;
      }

      if (
        field.kind === FieldKind.SCALAR &&
        field.scalarTypeName === "Boolean"
      ) {
        deserializedInstance[field.name] = value === 1 ? true : false;
        return;
      }

      if (
        field.kind === FieldKind.SCALAR &&
        field.scalarTypeName === "BigInt"
      ) {
        deserializedInstance[field.name] = blobToBigInt(
          value as unknown as Buffer
        );
        return;
      }

      if (field.kind === FieldKind.LIST) {
        deserializedInstance[field.name] = JSON.parse(value as string);
        return;
      }

      deserializedInstance[field.name] = value;
    });

    return deserializedInstance;
  };
}
