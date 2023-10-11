import { randomBytes } from "crypto";
import { CompiledQuery, Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import { isEnumType } from "@/schema/schema";
import type { Schema } from "@/schema/types";
import { blobToBigInt } from "@/utils/decode";

import type {
  ModelInstance,
  OrderByInput,
  UserStore,
  WhereInput,
} from "../store";
import { formatModelFieldValue, formatModelInstance } from "../utils/format";
import { validateSkip, validateTake } from "../utils/pagination";
import {
  buildSqlOrderByConditions,
  buildSqlWhereConditions,
} from "../utils/where";

const MAX_INTEGER = 2_147_483_647 as const;
const MAX_BATCH_SIZE = 1_000 as const;

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: sql`bytea`,
  bytes: "text",
} as const;

export class PostgresUserStore implements UserStore {
  db: Kysely<any>;

  schema?: Schema;
  versionId?: string;

  constructor({
    pool,
    databaseSchema,
  }: {
    pool: Pool;
    databaseSchema?: string;
  }) {
    this.db = new Kysely({
      dialect: new PostgresDialect({
        pool,
        onCreateConnection: databaseSchema
          ? async (connection) => {
              await connection.executeQuery(
                CompiledQuery.raw(
                  `CREATE SCHEMA IF NOT EXISTS ${databaseSchema}`
                )
              );
              await connection.executeQuery(
                CompiledQuery.raw(`SET search_path = ${databaseSchema}`)
              );
            }
          : undefined,
      }),
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
          Object.keys(this.schema.tables).map((tableName) => {
            const dbTableName = `${tableName}_${this.versionId}`;
            tx.schema.dropTable(dbTableName);
          })
        );
      }

      if (schema) this.schema = schema;

      this.versionId = randomBytes(4).toString("hex");

      // Create tables for new schema.
      await Promise.all(
        Object.entries(this.schema!.tables).map(async ([tableName, table]) => {
          const dbTableName = `${tableName}_${this.versionId}`;
          let tableBuilder = tx.schema.createTable(dbTableName);
          Object.entries(table).forEach(([columnName, column]) => {
            // Handle scalar list columns
            if (column.list) {
              tableBuilder = tableBuilder.addColumn(
                columnName,
                "text",
                (col) => {
                  if (!column.optional) col = col.notNull();
                  return col;
                }
              );
            } else if (isEnumType(column.type)) {
              // Handle enum types
              tableBuilder = tableBuilder.addColumn(
                columnName,
                "text",
                (col) => {
                  if (!column.optional) col = col.notNull();
                  col = col.check(
                    sql`${sql.ref(columnName)} in (${sql.join(
                      schema!.enums[column.type.slice(5)].map((v) => sql.lit(v))
                    )})`
                  );
                  return col;
                }
              );
            } else {
              // Handle all other column types
              tableBuilder = tableBuilder.addColumn(
                columnName,
                scalarToSqlType[column.type],
                (col) => {
                  if (!column.optional) col = col.notNull();
                  return col;
                }
              );
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
            `${dbTableName}_id_effectiveTo_unique`,
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
        Object.keys(this.schema!.tables).map((tableName) => {
          const dbTableName = `${tableName}_${this.versionId}`;
          tx.schema.dropTable(dbTableName);
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
    timestamp = MAX_INTEGER,
    id,
    data = {},
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Omit<ModelInstance, "id">;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const createInstance = formatModelInstance({ id, ...data });

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
    timestamp = MAX_INTEGER,
    id,
    data = {},
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data?:
      | Partial<Omit<ModelInstance, "id">>
      | ((args: {
          current: ModelInstance;
        }) => Partial<Omit<ModelInstance, "id">>);
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });

    const instance = await this.db.transaction().execute(async (tx) => {
      // Find the latest version of this instance.
      const latestInstance = await tx
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", formattedId)
        .orderBy("effectiveTo", "desc")
        .executeTakeFirstOrThrow();

      // If the user passed an update function, call it with the current instance.
      let updateInstance: ReturnType<typeof formatModelInstance>;
      if (typeof data === "function") {
        const updateObject = data({
          current: this.deserializeInstance({
            modelName,
            instance: latestInstance,
          }),
        });
        updateInstance = formatModelInstance({ id, ...updateObject });
      } else {
        updateInstance = formatModelInstance({ id, ...data });
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

  upsert = async ({
    modelName,
    timestamp = MAX_INTEGER,
    id,
    create = {},
    update = {},
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    create?: Omit<ModelInstance, "id">;
    update?:
      | Partial<Omit<ModelInstance, "id">>
      | ((args: {
          current: ModelInstance;
        }) => Partial<Omit<ModelInstance, "id">>);
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });
    const createInstance = formatModelInstance({ id, ...create });

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

      // If the user passed an update function, call it with the current instance.
      let updateInstance: ReturnType<typeof formatModelInstance>;
      if (typeof update === "function") {
        const updateObject = update({
          current: this.deserializeInstance({
            modelName,
            instance: latestInstance,
          }),
        });
        updateInstance = formatModelInstance({ id, ...updateObject });
      } else {
        updateInstance = formatModelInstance({ id, ...update });
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
    timestamp = MAX_INTEGER,
    id,
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const formattedId = formatModelFieldValue({ value: id });

    const instance = await this.db.transaction().execute(async (tx) => {
      // If the latest version is effective from the delete timestamp,
      // then delete the instance in place. It "never existed".
      // This needs to be done first, because an update() earlier in the handler
      // call would have created a new version with the delete timestamp.
      // Attempting to update first would result in a constraint violation.
      let deletedInstance = await tx
        .deleteFrom(tableName)
        .where("id", "=", formattedId)
        .where("effectiveFrom", "=", timestamp)
        .returning(["id"])
        .executeTakeFirst();

      // Update the latest version to be effective until the delete timestamp.
      if (!deletedInstance) {
        deletedInstance = await tx
          .updateTable(tableName)
          .set({ effectiveTo: timestamp - 1 })
          .where("id", "=", formattedId)
          .where("effectiveTo", "=", MAX_INTEGER)
          .returning(["id", "effectiveFrom"])
          .executeTakeFirst();
      }

      return !!deletedInstance;
    });

    return instance;
  };

  findMany = async ({
    modelName,
    timestamp = MAX_INTEGER,
    where,
    skip,
    take,
    orderBy,
  }: {
    modelName: string;
    timestamp: number;
    where?: WhereInput<any>;
    skip?: number;
    take?: number;
    orderBy?: OrderByInput<any>;
  }) => {
    const tableName = `${modelName}_${this.versionId}`;

    let query = this.db
      .selectFrom(tableName)
      .selectAll()
      .where("effectiveFrom", "<=", timestamp)
      .where("effectiveTo", ">=", timestamp);

    if (where) {
      const whereConditions = buildSqlWhereConditions({ where });
      for (const whereCondition of whereConditions) {
        query = query.where(...whereCondition);
      }
    }

    if (skip) {
      const offset = validateSkip(skip);
      query = query.offset(offset);
    }

    if (take) {
      const limit = validateTake(take);
      query = query.limit(limit);
    }

    if (orderBy) {
      const orderByConditions = buildSqlOrderByConditions({ orderBy });
      for (const [fieldName, direction] of orderByConditions) {
        query = query.orderBy(
          fieldName,
          direction === "asc" || direction === undefined
            ? sql`asc nulls first`
            : sql`desc nulls last`
        );
      }
    }

    const instances = await query.execute();

    return instances.map((instance) =>
      this.deserializeInstance({ modelName, instance })
    );
  };

  createMany = async ({
    modelName,
    timestamp = MAX_INTEGER,
    data,
  }: {
    modelName: string;
    timestamp: number;
    id: string | number | bigint;
    data: ModelInstance[];
  }) => {
    const tableName = `${modelName}_${this.versionId}`;
    const createInstances = data.map((d) => ({
      ...formatModelInstance({ ...d }),
      effectiveFrom: timestamp,
      effectiveTo: MAX_INTEGER,
    }));

    const chunkedInstances = [];
    for (let i = 0, len = createInstances.length; i < len; i += MAX_BATCH_SIZE)
      chunkedInstances.push(createInstances.slice(i, i + MAX_BATCH_SIZE));

    const instances = await Promise.all(
      chunkedInstances.map((c) =>
        this.db.insertInto(tableName).values(c).returningAll().execute()
      )
    );

    return instances
      .flat()
      .map((instance) => this.deserializeInstance({ modelName, instance }));
  };

  updateMany = async ({
    modelName,
    timestamp = MAX_INTEGER,
    where,
    data = {},
  }: {
    modelName: string;
    timestamp: number;
    where: WhereInput<any>;
    data?:
      | Partial<Omit<ModelInstance, "id">>
      | ((args: {
          current: ModelInstance;
        }) => Partial<Omit<ModelInstance, "id">>);
  }) => {
    const tableName = `${modelName}_${this.versionId}`;

    const instances = await this.db.transaction().execute(async (tx) => {
      // Get all IDs that match the filter.
      let latestInstancesQuery = tx
        .selectFrom(tableName)
        .selectAll()
        .where("effectiveFrom", "<=", timestamp)
        .where("effectiveTo", ">=", timestamp);

      if (where) {
        const whereConditions = buildSqlWhereConditions({ where });
        for (const whereCondition of whereConditions) {
          latestInstancesQuery = latestInstancesQuery.where(...whereCondition);
        }
      }

      const latestInstances = await latestInstancesQuery.execute();

      // TODO: This is probably incredibly slow. Ideally, we'd do most of this in the database.
      return await Promise.all(
        latestInstances.map(async (latestInstance) => {
          const formattedId = latestInstance.id;

          // If the user passed an update function, call it with the current instance.
          let updateInstance: ReturnType<typeof formatModelInstance>;
          if (typeof data === "function") {
            const updateObject = data({
              current: this.deserializeInstance({
                modelName,
                instance: latestInstance,
              }),
            });
            updateInstance = formatModelInstance(updateObject);
          } else {
            updateInstance = formatModelInstance(data);
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
        })
      );
    });

    return instances.map((instance) =>
      this.deserializeInstance({ modelName, instance })
    );
  };

  revert = async ({ safeTimestamp }: { safeTimestamp: number }) => {
    await this.db.transaction().execute(async (tx) => {
      await Promise.all(
        Object.keys(this.schema?.tables ?? {}).map(async (tableName) => {
          const dbTableName = `${tableName}_${this.versionId}`;
          // Delete any versions that are newer than the safe timestamp.
          await tx
            .deleteFrom(dbTableName)
            .where("effectiveFrom", ">", safeTimestamp)
            .execute();

          // Now, any versions that have effectiveTo greater than or equal
          // to the safe timestamp are the new latest version.
          await tx
            .updateTable(dbTableName)
            .where("effectiveTo", ">=", safeTimestamp)
            .set({ effectiveTo: MAX_INTEGER })
            .execute();
        })
      );
    });
  };

  private deserializeInstance = ({
    modelName,
    instance,
  }: {
    modelName: string;
    instance: Record<string, unknown>;
  }) => {
    const entity = Object.entries(this.schema!.tables).find(
      ([name]) => name === modelName
    )![1];
    const deserializedInstance = {} as ModelInstance;

    Object.entries(entity).forEach(([columnName, column]) => {
      const value = instance[columnName] as string | number | null | undefined;

      if (value === null || value === undefined) {
        deserializedInstance[columnName] = null;
        return;
      }

      if (column.list) {
        let parsedValue = JSON.parse(value as string);
        if (column.type === "bigint") parsedValue = parsedValue.map(BigInt);
        deserializedInstance[columnName] = parsedValue;
        return;
      }

      if (column.type === "boolean") {
        deserializedInstance[columnName] = value === 1 ? true : false;
        return;
      }

      if (column.type === "bigint") {
        deserializedInstance[columnName] = blobToBigInt(
          value as unknown as Buffer
        );
        return;
      }

      deserializedInstance[columnName] = value;
    });

    return deserializedInstance;
  };
}
