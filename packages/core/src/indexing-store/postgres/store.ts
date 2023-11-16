import { randomBytes } from "crypto";
import { CompiledQuery, Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";

import type { Scalar, Schema } from "@/schema/types.js";
import {
  isEnumColumn,
  isReferenceColumn,
  isVirtualColumn,
} from "@/schema/utils.js";

import type { IndexingStore, OrderByInput, Row, WhereInput } from "../store.js";
import { formatColumnValue, formatRow } from "../utils/format.js";
import { validateSkip, validateTake } from "../utils/pagination.js";
import {
  buildSqlOrderByConditions,
  buildSqlWhereConditions,
} from "../utils/where.js";

const MAX_INTEGER = 2_147_483_647 as const;
const MAX_BATCH_SIZE = 1_000 as const;

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "numeric(78, 0)",
  bytes: "text",
} as const;

export class PostgresIndexingStore implements IndexingStore {
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
                  `CREATE SCHEMA IF NOT EXISTS ${databaseSchema}`,
                ),
              );
              await connection.executeQuery(
                CompiledQuery.raw(`SET search_path = ${databaseSchema}`),
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
    // If there is no existing schema and no new schema was provided, do nothing.
    if (!this.schema && !schema) return;

    await this.db.transaction().execute(async (tx) => {
      // Drop tables from existing schema if present.
      if (this.schema) {
        const tableNames = Object.keys(this.schema?.tables ?? {});
        if (tableNames.length > 0) {
          await Promise.all(
            tableNames.map(async (tableName) => {
              const table = `${tableName}_${this.versionId}`;
              await tx.schema.dropTable(table).execute();
            }),
          );
        }
      }

      if (schema) this.schema = schema;

      this.versionId = randomBytes(4).toString("hex");

      // Create tables for new schema.
      await Promise.all(
        Object.entries(this.schema!.tables).map(
          async ([tableName, columns]) => {
            const table = `${tableName}_${this.versionId}`;
            let tableBuilder = tx.schema.createTable(table);

            Object.entries(columns).forEach(([columnName, column]) => {
              // Handle scalar list columns
              if (isVirtualColumn(column)) return;
              else if (isEnumColumn(column)) {
                // Handle enum types
                tableBuilder = tableBuilder.addColumn(
                  columnName,
                  "text",
                  (col) => {
                    if (!column.optional) col = col.notNull();
                    col = col.check(
                      sql`${sql.ref(columnName)} in (${sql.join(
                        schema!.enums[column.type].map((v) => sql.lit(v)),
                      )})`,
                    );
                    return col;
                  },
                );
              } else if (column.list) {
                tableBuilder = tableBuilder.addColumn(
                  columnName,
                  "text",
                  (col) => {
                    if (!column.optional) col = col.notNull();
                    return col;
                  },
                );
              } else {
                // Non-list base column
                tableBuilder = tableBuilder.addColumn(
                  columnName,
                  scalarToSqlType[column.type],
                  (col) => {
                    if (!column.optional) col = col.notNull();
                    return col;
                  },
                );
              }
            });

            // Add the effective timestamp columns.
            tableBuilder = tableBuilder.addColumn(
              "effectiveFrom",
              "integer",
              (col) => col.notNull(),
            );
            tableBuilder = tableBuilder.addColumn(
              "effectiveTo",
              "integer",
              (col) => col.notNull(),
            );
            tableBuilder = tableBuilder.addPrimaryKeyConstraint(
              `${table}_id_effectiveTo_unique`,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              ["id", "effectiveTo"],
            );

            await tableBuilder.execute();
          },
        ),
      );
    });
  };

  async kill() {
    const tableNames = Object.keys(this.schema?.tables ?? {});
    if (tableNames.length > 0) {
      await this.db.transaction().execute(async (tx) => {
        await Promise.all(
          tableNames.map(async (tableName) => {
            await tx.schema
              .dropTable(`${tableName}_${this.versionId}`)
              .execute();
          }),
        );
      });
    }

    await this.db.destroy();
  }

  findUnique = async ({
    tableName,
    timestamp = MAX_INTEGER,
    id,
  }: {
    tableName: string;
    timestamp?: number;
    id: string | number | bigint;
  }) => {
    const table = `${tableName}_${this.versionId}`;
    const formattedId = formatColumnValue({
      value: id,
      encodeBigInts: false,
    });

    const rows = await this.db
      .selectFrom(table)
      .selectAll()
      .where("id", "=", formattedId)
      .where("effectiveFrom", "<=", timestamp)
      .where("effectiveTo", ">=", timestamp)
      .execute();

    if (rows.length > 1) {
      throw new Error(`Expected 1 row, found ${rows.length}`);
    }

    return rows[0] ? this.deserializeRow({ tableName, row: rows[0] }) : null;
  };

  create = async ({
    tableName,
    timestamp = MAX_INTEGER,
    id,
    data = {},
  }: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }) => {
    const table = `${tableName}_${this.versionId}`;
    const createRow = formatRow({ id, ...data }, false);

    const row = await this.db
      .insertInto(table)
      .values({
        ...createRow,
        effectiveFrom: timestamp,
        effectiveTo: MAX_INTEGER,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.deserializeRow({ tableName, row });
  };

  update = async ({
    tableName,
    timestamp = MAX_INTEGER,
    id,
    data = {},
  }: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = `${tableName}_${this.versionId}`;
    const formattedId = formatColumnValue({
      value: id,
      encodeBigInts: false,
    });

    const row = await this.db.transaction().execute(async (tx) => {
      // Find the latest version of this row.
      const latestRow = await tx
        .selectFrom(table)
        .selectAll()
        .where("id", "=", formattedId)
        .orderBy("effectiveTo", "desc")
        .executeTakeFirstOrThrow();

      // If the user passed an update function, call it with the current row.
      let updateRow: ReturnType<typeof formatRow>;
      if (typeof data === "function") {
        const updateObject = data({
          current: this.deserializeRow({
            tableName,
            row: latestRow,
          }),
        });
        updateRow = formatRow({ id, ...updateObject }, false);
      } else {
        updateRow = formatRow({ id, ...data }, false);
      }

      // If the latest version has the same effectiveFrom timestamp as the update,
      // this update is occurring within the same block/second. Update in place.
      if (latestRow.effectiveFrom === timestamp) {
        return await tx
          .updateTable(table)
          .set(updateRow)
          .where("id", "=", formattedId)
          .where("effectiveFrom", "=", timestamp)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      if (latestRow.effectiveFrom > timestamp) {
        throw new Error(`Cannot update an row in the past`);
      }

      // If the latest version has an earlier effectiveFrom timestamp than the update,
      // we need to update the latest version AND insert a new version.
      await tx
        .updateTable(table)
        .set({ effectiveTo: timestamp - 1 })
        .where("id", "=", formattedId)
        .where("effectiveTo", "=", MAX_INTEGER)
        .execute();

      return await tx
        .insertInto(table)
        .values({
          ...latestRow,
          ...updateRow,
          effectiveFrom: timestamp,
          effectiveTo: MAX_INTEGER,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return this.deserializeRow({ tableName, row });
  };

  upsert = async ({
    tableName,
    timestamp = MAX_INTEGER,
    id,
    create = {},
    update = {},
  }: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    create?: Omit<Row, "id">;
    update?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = `${tableName}_${this.versionId}`;
    const formattedId = formatColumnValue({
      value: id,
      encodeBigInts: false,
    });
    const createRow = formatRow({ id, ...create }, false);

    const row = await this.db.transaction().execute(async (tx) => {
      // Attempt to find the latest version of this row.
      const latestRow = await tx
        .selectFrom(table)
        .selectAll()
        .where("id", "=", formattedId)
        .orderBy("effectiveTo", "desc")
        .executeTakeFirst();

      // If there is no latest version, insert a new version using the create data.
      if (!latestRow) {
        return await tx
          .insertInto(table)
          .values({
            ...createRow,
            effectiveFrom: timestamp,
            effectiveTo: MAX_INTEGER,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      // If the user passed an update function, call it with the current row.
      let updateRow: ReturnType<typeof formatRow>;
      if (typeof update === "function") {
        const updateObject = update({
          current: this.deserializeRow({
            tableName,
            row: latestRow,
          }),
        });
        updateRow = formatRow({ id, ...updateObject }, false);
      } else {
        updateRow = formatRow({ id, ...update }, false);
      }

      // If the latest version has the same effectiveFrom timestamp as the update,
      // this update is occurring within the same block/second. Update in place.
      if (latestRow.effectiveFrom === timestamp) {
        return await tx
          .updateTable(table)
          .set(updateRow)
          .where("id", "=", formattedId)
          .where("effectiveFrom", "=", timestamp)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      if (latestRow.effectiveFrom > timestamp) {
        throw new Error(`Cannot update an row in the past`);
      }

      // If the latest version has an earlier effectiveFrom timestamp than the update,
      // we need to update the latest version AND insert a new version.
      await tx
        .updateTable(table)
        .set({ effectiveTo: timestamp - 1 })
        .where("id", "=", formattedId)
        .where("effectiveTo", "=", MAX_INTEGER)
        .execute();

      return await tx
        .insertInto(table)
        .values({
          ...latestRow,
          ...updateRow,
          effectiveFrom: timestamp,
          effectiveTo: MAX_INTEGER,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    return this.deserializeRow({ tableName, row });
  };

  delete = async ({
    tableName,
    timestamp = MAX_INTEGER,
    id,
  }: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
  }) => {
    const table = `${tableName}_${this.versionId}`;
    const formattedId = formatColumnValue({
      value: id,
      encodeBigInts: false,
    });

    const row = await this.db.transaction().execute(async (tx) => {
      // If the latest version is effective from the delete timestamp,
      // then delete the row in place. It "never existed".
      // This needs to be done first, because an update() earlier in the
      // indexing function would have created a new version with the delete timestamp.
      // Attempting to update first would result in a constraint violation.
      let deletedRow = await tx
        .deleteFrom(table)
        .where("id", "=", formattedId)
        .where("effectiveFrom", "=", timestamp)
        .returning(["id"])
        .executeTakeFirst();

      // Update the latest version to be effective until the delete timestamp.
      if (!deletedRow) {
        deletedRow = await tx
          .updateTable(table)
          .set({ effectiveTo: timestamp - 1 })
          .where("id", "=", formattedId)
          .where("effectiveTo", "=", MAX_INTEGER)
          .returning(["id", "effectiveFrom"])
          .executeTakeFirst();
      }

      return !!deletedRow;
    });

    return row;
  };

  findMany = async ({
    tableName,
    timestamp = MAX_INTEGER,
    where,
    skip,
    take,
    orderBy,
  }: {
    tableName: string;
    timestamp: number;
    where?: WhereInput<any>;
    skip?: number;
    take?: number;
    orderBy?: OrderByInput<any>;
  }) => {
    const table = `${tableName}_${this.versionId}`;

    let query = this.db
      .selectFrom(table)
      .selectAll()
      .where("effectiveFrom", "<=", timestamp)
      .where("effectiveTo", ">=", timestamp);

    if (where) {
      const whereConditions = buildSqlWhereConditions({
        where,
        encodeBigInts: false,
      });
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
            : sql`desc nulls last`,
        );
      }
    }

    const rows = await query.execute();

    return rows.map((row) => this.deserializeRow({ tableName, row }));
  };

  createMany = async ({
    tableName,
    timestamp = MAX_INTEGER,
    data,
  }: {
    tableName: string;
    timestamp: number;
    id: string | number | bigint;
    data: Row[];
  }) => {
    const table = `${tableName}_${this.versionId}`;
    const createRows = data.map((d) => ({
      ...formatRow({ ...d }, false),
      effectiveFrom: timestamp,
      effectiveTo: MAX_INTEGER,
    }));

    const chunkedRows = [];
    for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
      chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

    const rows = await Promise.all(
      chunkedRows.map((c) =>
        this.db.insertInto(table).values(c).returningAll().execute(),
      ),
    );

    return rows.flat().map((row) => this.deserializeRow({ tableName, row }));
  };

  updateMany = async ({
    tableName,
    timestamp = MAX_INTEGER,
    where,
    data = {},
  }: {
    tableName: string;
    timestamp: number;
    where: WhereInput<any>;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = `${tableName}_${this.versionId}`;

    const rows = await this.db.transaction().execute(async (tx) => {
      // Get all IDs that match the filter.
      let latestRowsQuery = tx
        .selectFrom(table)
        .selectAll()
        .where("effectiveFrom", "<=", timestamp)
        .where("effectiveTo", ">=", timestamp);

      if (where) {
        const whereConditions = buildSqlWhereConditions({
          where,
          encodeBigInts: false,
        });
        for (const whereCondition of whereConditions) {
          latestRowsQuery = latestRowsQuery.where(...whereCondition);
        }
      }

      const latestRows = await latestRowsQuery.execute();

      // TODO: This is probably incredibly slow. Ideally, we'd do most of this in the database.
      return await Promise.all(
        latestRows.map(async (latestRow) => {
          const formattedId = latestRow.id;

          // If the user passed an update function, call it with the current row.
          let updateRow: ReturnType<typeof formatRow>;
          if (typeof data === "function") {
            const updateObject = data({
              current: this.deserializeRow({
                tableName,
                row: latestRow,
              }),
            });
            updateRow = formatRow(updateObject, false);
          } else {
            updateRow = formatRow(data, false);
          }

          // If the latest version has the same effectiveFrom timestamp as the update,
          // this update is occurring within the same block/second. Update in place.
          if (latestRow.effectiveFrom === timestamp) {
            return await tx
              .updateTable(table)
              .set(updateRow)
              .where("id", "=", formattedId)
              .where("effectiveFrom", "=", timestamp)
              .returningAll()
              .executeTakeFirstOrThrow();
          }

          if (latestRow.effectiveFrom > timestamp) {
            throw new Error(`Cannot update an row in the past`);
          }

          // If the latest version has an earlier effectiveFrom timestamp than the update,
          // we need to update the latest version AND insert a new version.
          await tx
            .updateTable(table)
            .set({ effectiveTo: timestamp - 1 })
            .where("id", "=", formattedId)
            .where("effectiveTo", "=", MAX_INTEGER)
            .execute();

          return await tx
            .insertInto(table)
            .values({
              ...latestRow,
              ...updateRow,
              effectiveFrom: timestamp,
              effectiveTo: MAX_INTEGER,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        }),
      );
    });

    return rows.map((row) => this.deserializeRow({ tableName, row }));
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
        }),
      );
    });
  };

  private deserializeRow = ({
    tableName,
    row,
  }: {
    tableName: string;
    row: Record<string, unknown>;
  }) => {
    const columns = Object.entries(this.schema!.tables).find(
      ([name]) => name === tableName,
    )![1];
    const deserializedRow = {} as Row;

    Object.entries(columns).forEach(([columnName, column]) => {
      const value = row[columnName] as
        | string
        | number
        | bigint
        | null
        | undefined;

      if (value === null || value === undefined) {
        deserializedRow[columnName] = null;
        return;
      }

      if (isVirtualColumn(column)) return;
      else if (
        !isEnumColumn(column) &&
        !isReferenceColumn(column) &&
        column.list
      ) {
        let parsedValue = JSON.parse(value as string);
        if (column.type === "bigint") parsedValue = parsedValue.map(BigInt);
        deserializedRow[columnName] = parsedValue;
        return;
      }

      if ((column.type as Scalar) === "boolean") {
        deserializedRow[columnName] = value === 1 ? true : false;
        return;
      }

      if (column.type === "bigint") {
        deserializedRow[columnName] = value;
        return;
      }

      deserializedRow[columnName] = value;
    });

    return deserializedRow;
  };
}
