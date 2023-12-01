import { Kysely, sql, SqliteDialect } from "kysely";

import type { Common } from "@/Ponder.js";
import type { Scalar, Schema } from "@/schema/types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
} from "@/schema/utils.js";
import { decodeToBigInt } from "@/utils/encoding.js";
import { ensureDirExists } from "@/utils/exists.js";
import { BetterSqlite3, improveSqliteErrors } from "@/utils/sqlite.js";

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
  bigint: "varchar(79)",
  bytes: "text",
} as const;

export class SqliteIndexingStore implements IndexingStore {
  kind = "sqlite" as const;
  private common: Common;

  db: Kysely<any>;

  schema?: Schema;

  constructor({ common, file }: { common: Common; file: string }) {
    this.common = common;
    ensureDirExists(file);
    const database = new BetterSqlite3(file);
    improveSqliteErrors(database);
    database.pragma("journal_mode = WAL");
    this.db = new Kysely({
      dialect: new SqliteDialect({ database }),
    });
  }

  async kill() {
    return this.wrap({ method: "kill" }, async () => {
      const tableNames = Object.keys(this.schema?.tables ?? {});
      if (tableNames.length > 0) {
        await this.db.transaction().execute(async (tx) => {
          await Promise.all(
            tableNames.map(async (tableName) => {
              const table = `${tableName}_versioned`;
              await tx.schema.dropTable(table).ifExists().execute();
            }),
          );
        });
      }

      try {
        await this.db.destroy();
      } catch (e) {
        const error = e as Error;
        if (error.message !== "Called end on pool more than once") {
          throw error;
        }
      }
    });
  }

  /**
   * Resets the database by dropping existing tables and creating new tables.
   * If no new schema is provided, the existing schema is used.
   *
   * @param options.schema New schema to be used.
   */
  reload = async ({ schema }: { schema?: Schema } = {}) => {
    return this.wrap({ method: "reload" }, async () => {
      // If there is no existing schema and no new schema was provided, do nothing.
      if (!this.schema && !schema) return;

      // Set the new schema.
      if (schema) this.schema = schema;

      await this.db.transaction().execute(async (tx) => {
        // Create tables for new schema.
        await Promise.all(
          Object.entries(this.schema!.tables).map(
            async ([tableName, columns]) => {
              const table = `${tableName}_versioned`;

              // Drop existing table with the same name if it exists.
              await tx.schema.dropTable(table).ifExists().execute();

              let tableBuilder = tx.schema.createTable(table);

              Object.entries(columns).forEach(([columnName, column]) => {
                if (isOneColumn(column)) return;
                if (isManyColumn(column)) return;
                if (isEnumColumn(column)) {
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
                  // Handle scalar list columns
                  tableBuilder = tableBuilder.addColumn(
                    columnName,
                    "text",
                    (col) => {
                      if (!column.optional) col = col.notNull();
                      return col;
                    },
                  );
                } else {
                  // Non-list base columns
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
    });
  };

  revert = async ({ safeTimestamp }: { safeTimestamp: number }) => {
    return this.wrap({ method: "revert" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await Promise.all(
          Object.keys(this.schema?.tables ?? {}).map(async (tableName) => {
            const table = `${tableName}_versioned`;

            // Delete any versions that are newer than the safe timestamp.
            await tx
              .deleteFrom(table)
              .where("effectiveFrom", ">", safeTimestamp)
              .execute();

            // Now, any versions that have effectiveTo greater than or equal
            // to the safe timestamp are the new latest version.
            await tx
              .updateTable(table)
              .where("effectiveTo", ">=", safeTimestamp)
              .set({ effectiveTo: MAX_INTEGER })
              .execute();
          }),
        );
      });
    });
  };

  findUnique = async ({
    tableName,
    timestamp = MAX_INTEGER,
    id,
  }: {
    tableName: string;
    timestamp?: number;
    id: string | number | bigint;
  }) => {
    return this.wrap({ method: "findUnique", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: true,
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

      const result = rows[0]
        ? this.deserializeRow({ tableName, row: rows[0] })
        : null;

      return result;
    });
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
    return this.wrap({ method: "create", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const createRow = formatRow({ id, ...data }, true);

      const row = await this.db
        .insertInto(table)
        .values({
          ...createRow,
          effectiveFrom: timestamp,
          effectiveTo: MAX_INTEGER,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = this.deserializeRow({ tableName, row });

      return result;
    });
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
    return this.wrap({ method: "update", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: true,
      });

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(table)
          .selectAll()
          .where("id", "=", formattedId)
          .orderBy("effectiveTo", "desc")
          .executeTakeFirstOrThrow();

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof formatRow>;
        if (typeof data === "function") {
          const updateObject = data({
            current: this.deserializeRow({
              tableName,
              row: latestRow,
            }),
          });
          updateRow = formatRow({ id, ...updateObject }, true);
        } else {
          updateRow = formatRow({ id, ...data }, true);
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
          throw new Error(`Cannot update a record in the past`);
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

      const result = this.deserializeRow({ tableName, row });

      return result;
    });
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
    return this.wrap({ method: "upsert", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: true,
      });
      const createRow = formatRow({ id, ...create }, true);

      const row = await this.db.transaction().execute(async (tx) => {
        // Attempt to find the latest version of this instance.
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
          updateRow = formatRow({ id, ...updateObject }, true);
        } else {
          updateRow = formatRow({ id, ...update }, true);
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
          throw new Error(`Cannot update a record in the past`);
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
    });
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
    return this.wrap({ method: "delete", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: true,
      });

      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version is effective from the delete timestamp,
        // then delete the instance in place. It "never existed".
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

      return isDeleted;
    });
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
    return this.wrap({ method: "findMany", tableName }, async () => {
      const table = `${tableName}_versioned`;

      let query = this.db
        .selectFrom(table)
        .selectAll()
        .where("effectiveFrom", "<=", timestamp)
        .where("effectiveTo", ">=", timestamp);

      if (where) {
        const whereConditions = buildSqlWhereConditions({
          where,
          encodeBigInts: true,
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
        for (const orderByCondition of orderByConditions) {
          query = query.orderBy(...orderByCondition);
        }
      }

      const rows = await query.execute();
      return rows.map((row) => this.deserializeRow({ tableName, row }));
    });
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
    return this.wrap({ method: "createMany", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const createRows = data.map((d) => ({
        ...formatRow({ ...d }, true),
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
    });
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
    return this.wrap({ method: "updateMany", tableName }, async () => {
      const table = `${tableName}_versioned`;

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
            encodeBigInts: true,
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

            // If the user passed an update function, call it with the current instance.
            let updateRow: ReturnType<typeof formatRow>;
            if (typeof data === "function") {
              const updateObject = data({
                current: this.deserializeRow({
                  tableName,
                  row: latestRow,
                }),
              });
              updateRow = formatRow(updateObject, true);
            } else {
              updateRow = formatRow(data, true);
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
              throw new Error(`Cannot update an instance in the past`);
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
      const value = row[columnName] as string | number | null | undefined;

      if (value === null || value === undefined) {
        deserializedRow[columnName] = null;
        return;
      }

      if (isOneColumn(column)) return;
      if (isManyColumn(column)) return;
      if (!isEnumColumn(column) && !isReferenceColumn(column) && column.list) {
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
        deserializedRow[columnName] = decodeToBigInt(
          value as unknown as string,
        );
        return;
      }

      deserializedRow[columnName] = value;
    });

    return deserializedRow;
  };

  private wrap = async <T>(
    options: { method: string; tableName?: string },
    fn: () => Promise<T>,
  ) => {
    const start = performance.now();
    try {
      return await fn();
    } catch (err) {
      // This fixes the stack trace for SQLite errors.
      Error.captureStackTrace(err as Error);
      throw err;
    } finally {
      this.common.metrics.ponder_indexing_store_method_duration.observe(
        { method: options.method, table: options.tableName },
        performance.now() - start,
      );
    }
  };
}
