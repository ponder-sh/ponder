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

const MAX_INTEGER = 2_147_483_647 as const;

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

          // Add the effective timestamp columns.
          tableBuilder = tableBuilder.addColumn(
            "effectiveFrom",
            "integer",
            (col) => col.notNull()
          );
          tableBuilder = tableBuilder.addColumn(
            "effectiveTo",
            "integer",
            (col) => col.notNull()
          );
          tableBuilder = tableBuilder.addPrimaryKeyConstraint(
            `${tableName}_id_effectiveTo_unique`,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            ["id", "effectiveTo"]
          );

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
    timestamp = MAX_INTEGER,
    id,
  }: {
    modelName: string;
    timestamp?: number;
    id: string | number | bigint;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });

    const instances = await this.db
      .selectFrom(tableName)
      .selectAll()
      .where("id", "=", formattedId)
      .where("effectiveFrom", "<=", timestamp)
      .where("effectiveTo", ">=", timestamp)
      .execute();

    if (instances.length > 1) {
      throw new Error(`Expected 1 instance, found ${instances.length}`);
    }

    return instances[0]
      ? this.deserializeInstance({ modelName, instance: instances[0] })
      : null;
  };

  create = async ({
    modelName,
    timestamp,
    id,
    data = {},
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Omit<ModelInstance, "id">;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const createInstance = formatModelInstance({ id, data });

    const instance = await this.db
      .insertInto(tableName)
      .values({
        ...createInstance,
        effectiveFrom: timestamp,
        effectiveTo: MAX_INTEGER,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.deserializeInstance({ modelName, instance });
  };

  update = async ({
    modelName,
    timestamp,
    id,
    data = {},
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Partial<Omit<ModelInstance, "id">>;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });
    const updateInstance = formatModelInstance({ id, data });

    const instance = await this.db.transaction().execute(async (tx) => {
      // Find the latest version of this instance.
      const latestInstance = await tx
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", formattedId)
        .orderBy("effectiveTo", "desc")
        .executeTakeFirstOrThrow();

      // If the latest version has the same effectiveFrom timestamp as the update,
      // this update is occurring within the same block/second. Update in place.
      if (latestInstance.effectiveFrom === timestamp) {
        return await tx
          .updateTable(tableName)
          .set(updateInstance)
          .where("id", "=", formattedId)
          .where("effectiveFrom", "=", timestamp)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      if (latestInstance.effectiveFrom > timestamp) {
        throw new Error(`Cannot update an instance in the past`);
      }

      // If the latest version has an earlier effectiveFrom timestamp than the update,
      // we need to update the latest version AND insert a new version.
      await tx
        .updateTable(tableName)
        .set({ effectiveTo: timestamp - 1 })
        .where("id", "=", formattedId)
        .where("effectiveTo", "=", MAX_INTEGER)
        .execute();

      return await tx
        .insertInto(tableName)
        .values({
          ...latestInstance,
          ...updateInstance,
          effectiveFrom: timestamp,
          effectiveTo: MAX_INTEGER,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return this.deserializeInstance({ modelName, instance });
  };

  upsert = async ({
    modelName,
    timestamp,
    id,
    create = {},
    update = {},
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    create?: Omit<ModelInstance, "id">;
    update?: Partial<Omit<ModelInstance, "id">>;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });
    const createInstance = formatModelInstance({ id, data: create });
    const updateInstance = formatModelInstance({ id, data: update });

    const instance = await this.db.transaction().execute(async (tx) => {
      // Attempt to find the latest version of this instance.
      const latestInstance = await tx
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", formattedId)
        .orderBy("effectiveTo", "desc")
        .executeTakeFirst();

      // If there is no latest version, insert a new version using the create data.
      if (!latestInstance) {
        return await tx
          .insertInto(tableName)
          .values({
            ...createInstance,
            effectiveFrom: timestamp,
            effectiveTo: MAX_INTEGER,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      // If the latest version has the same effectiveFrom timestamp as the update,
      // this update is occurring within the same block/second. Update in place.
      if (latestInstance.effectiveFrom === timestamp) {
        return await tx
          .updateTable(tableName)
          .set(updateInstance)
          .where("id", "=", formattedId)
          .where("effectiveFrom", "=", timestamp)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      if (latestInstance.effectiveFrom > timestamp) {
        throw new Error(`Cannot update an instance in the past`);
      }

      // If the latest version has an earlier effectiveFrom timestamp than the update,
      // we need to update the latest version AND insert a new version.
      await tx
        .updateTable(tableName)
        .set({ effectiveTo: timestamp - 1 })
        .where("id", "=", formattedId)
        .where("effectiveTo", "=", MAX_INTEGER)
        .execute();

      return await tx
        .insertInto(tableName)
        .values({
          ...latestInstance,
          ...updateInstance,
          effectiveFrom: timestamp,
          effectiveTo: MAX_INTEGER,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return this.deserializeInstance({ modelName, instance });
  };

  delete = async ({
    modelName,
    timestamp,
    id,
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });

    const instance = await this.db.transaction().execute(async (tx) => {
      // Update the latest version to be effective until the delete timestamp.
      const deletedInstance = await tx
        .updateTable(tableName)
        .set({ effectiveTo: timestamp })
        .where("id", "=", formattedId)
        .where("effectiveTo", "=", MAX_INTEGER)
        .returning(["id", "effectiveFrom"])
        .executeTakeFirst();

      // If, after the update, the latest version is only effective from
      // the delete timestamp, delete the instance in place. It "never existed".
      if (deletedInstance?.effectiveFrom === timestamp) {
        await tx
          .deleteFrom(tableName)
          .where("id", "=", formattedId)
          .where("effectiveFrom", "=", timestamp)
          .returning(["id"])
          .executeTakeFirst();
      }

      return !!deletedInstance;
    });

    return instance;
  };

  findMany = async ({
    modelName,
    timestamp = MAX_INTEGER,
    filter = {},
  }: {
    modelName: string;
    timestamp: number;
    filter?: ModelFilter;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;

    let query = this.db
      .selectFrom(tableName)
      .selectAll()
      .where("effectiveFrom", "<=", timestamp)
      .where("effectiveTo", ">=", timestamp);

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
