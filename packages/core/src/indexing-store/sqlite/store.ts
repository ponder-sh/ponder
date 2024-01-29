import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import { Kysely, SqliteDialect, sql } from "kysely";
import { Kysely, SqliteDialect, sql } from "kysely";
import type { IndexingStore, OrderByInput, Row, WhereInput } from "../store.js";
import { decodeRow, encodeRow, encodeValue } from "../utils/encoding.js";
import { buildWhereConditions } from "../utils/filter.js";

const MAX_BATCH_SIZE = 1_000 as const;

const DEFAULT_LIMIT = 50 as const;
const MAX_LIMIT = 1_000 as const;

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "varchar(79)",
  hex: "blob",
} as const;

export class SqliteIndexingStore implements IndexingStore {
  kind = "sqlite" as const;
  private common: Common;

  db: Kysely<any>;

  schema?: Schema;

  constructor({
    common,
    database,
  }: {
    common: Common;
    database: SqliteDatabase;
  }) {
    this.common = common;
    this.db = new Kysely({
      dialect: new SqliteDialect({ database }),
      log(event) {
        if (event.level === "query")
          common.metrics.ponder_sqlite_query_count?.inc({ kind: "indexing" });
      },
    });
  }

  async teardown() {
    return this.wrap({ method: "teardown" }, async () => {
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
    });
  }

  async kill() {
    return this.wrap({ method: "kill" }, async () => {
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
                      if (!column.list) {
                        col = col.check(
                          sql`${sql.ref(columnName)} in (${sql.join(
                            schema!.enums[column.type].map((v) => sql.lit(v)),
                          )})`,
                        );
                      }
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

              tableBuilder = tableBuilder.addColumn(
                "effectiveFromCheckpoint",
                "varchar(58)",
                (col) => col.notNull(),
              );
              tableBuilder = tableBuilder.addColumn(
                "effectiveToCheckpoint",
                "varchar(58)",
                (col) => col.notNull(),
              );
              tableBuilder = tableBuilder.addPrimaryKeyConstraint(
                `${table}_effectiveToCheckpoint_unique`,
                ["id", "effectiveToCheckpoint"] as never[],
              );

              await tableBuilder.execute();
            },
          ),
        );
      });
    });
  };

  publish = async () => {
    return this.wrap({ method: "publish" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        // Create views for the latest version of each table.
        await Promise.all(
          Object.entries(this.schema!.tables).map(
            async ([tableName, columns]) => {
              await tx.schema.dropView(tableName).ifExists().execute();

              const columnNames = Object.entries(columns)
                .filter(([, c]) => !isOneColumn(c) && !isManyColumn(c))
                .map(([name]) => name);
              await tx.schema
                .createView(tableName)
                .as(
                  tx
                    .selectFrom(`${tableName}_versioned`)
                    .select(columnNames)
                    .where("effectiveToCheckpoint", "=", "latest"),
                )
                .execute();
            },
          ),
        );
      });
    });
  };

  /**
   * Revert any changes that occurred during or after the specified checkpoint.
   */
  revert = async ({ checkpoint }: { checkpoint: Checkpoint }) => {
    return this.wrap({ method: "revert" }, async () => {
      await this.db.transaction().execute(async (tx) => {
        await Promise.all(
          Object.keys(this.schema?.tables ?? {}).map(async (tableName) => {
            const table = `${tableName}_versioned`;
            const encodedCheckpoint = encodeCheckpoint(checkpoint);

            // Delete any versions that are newer than or equal to the safe checkpoint.
            await tx
              .deleteFrom(table)
              .where("effectiveFromCheckpoint", ">=", encodedCheckpoint)
              .execute();

            // Now, any versions with effectiveToCheckpoint greater than or equal
            // to the safe checkpoint are the new latest version.
            await tx
              .updateTable(table)
              .set({ effectiveToCheckpoint: "latest" })
              .where("effectiveToCheckpoint", ">=", encodedCheckpoint)
              .execute();
          }),
        );
      });
    });
  };

  findUnique = async ({
    tableName,
    checkpoint = "latest",
    id,
  }: {
    tableName: string;
    checkpoint?: Checkpoint | "latest";
    id: string | number | bigint;
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "findUnique", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");

      let query = this.db
        .selectFrom(versionedTableName)
        .selectAll()
        .where("id", "=", encodedId);

      if (checkpoint === "latest") {
        query = query.where("effectiveToCheckpoint", "=", "latest");
      } else {
        const encodedCheckpoint = encodeCheckpoint(checkpoint);
        query = query
          .where("effectiveFromCheckpoint", "<=", encodedCheckpoint)
          .where(({ eb, or }) =>
            or([
              eb("effectiveToCheckpoint", ">", encodedCheckpoint),
              eb("effectiveToCheckpoint", "=", "latest"),
            ]),
          );
      }

      const row = await query.executeTakeFirst();
      if (row === undefined) return null;

      return decodeRow(row, table, "sqlite");
    });
  };

  findMany = async ({
    tableName,
    checkpoint = "latest",
    where,
    orderBy,
    limit = DEFAULT_LIMIT,
    before = null,
    after = null,
  }: {
    tableName: string;
    checkpoint?: Checkpoint | "latest";
    where?: WhereInput<any>;
    orderBy?: OrderByInput<any>;
    limit?: number;
    before?: string | null;
    after?: string | null;
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "findMany", tableName }, async () => {
      let query = this.db.selectFrom(versionedTableName).selectAll();

      if (checkpoint === "latest") {
        query = query.where("effectiveToCheckpoint", "=", "latest");
      } else {
        const encodedCheckpoint = encodeCheckpoint(checkpoint);
        query = query
          .where("effectiveFromCheckpoint", "<=", encodedCheckpoint)
          .where(({ eb, or }) =>
            or([
              eb("effectiveToCheckpoint", ">", encodedCheckpoint),
              eb("effectiveToCheckpoint", "=", "latest"),
            ]),
          );
      }

      if (where) {
        const whereConditions = buildWhereConditions({
          where,
          table,
          encoding: "sqlite",
        });
        for (const [columnName, comparator, value] of whereConditions) {
          query = query.where(columnName, comparator, value);
        }
      }

      const orderByConditions: [column: string, direction: "asc" | "desc"][] =
        [];

      // Build the order by conditions.
      if (orderBy) {
        const conditions = Object.entries(orderBy);
        if (conditions.length > 1)
          throw new Error("Cannot order by multiple columns.");
        const [columnName, orderDirection] = conditions[0];
        // TODO: Validate column name. Should be a valid non-list column in the table.
        if (
          orderDirection === undefined ||
          !["asc", "desc"].includes(orderDirection)
        )
          throw new Error(
            `Invalid order direction. Received ${orderDirection}, expected 'asc' or 'desc'.`,
          );

        // If the specified order by column is not the ID column, add the
        // ID column as a secondary to enforce a consistent sort order.
        orderByConditions.push([columnName, orderDirection]);
        if (columnName !== "id") {
          orderByConditions.push(["id", "asc"]);
        }
      } else {
        // Default to ID ascending.
        orderByConditions.push(["id", "asc"]);
      }

      // Apply the ORDER BY conditions.
      for (const [column, direction] of orderByConditions) {
        query = query.orderBy(column, direction);
      }

      if (limit > MAX_LIMIT) {
        throw new Error(
          `Record limit is greater than the maximum allowed limit. Expected <=${MAX_LIMIT}, received ${limit}.`,
        );
      }
      // Fetch 1 additional row to determine the `after` cursor.
      query = query.limit(limit + 1);

      if (after !== null && before !== null) {
        throw new Error("Cannot specify both before and after cursors.");
      }

      // If neither cursors are specified, apply the order conditions and execute.
      if (after === null && before === null) {
        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "sqlite"));

        if (records.length === limit + 1) {
          records.pop();
          const lastRecord = records[records.length - 1];
          const nextAfter = encodeCursor(lastRecord, orderByConditions);
          return { items: records, before: null, after: nextAfter };
        } else {
          return { items: records, before: null, after: null };
        }
      }

      if (after !== null) {
        // User provided an 'after' cursor.

        // Apply the 'after' cursor WHERE clauses.
        const cursorConditions = decodeCursor(after, orderByConditions);
        if (cursorConditions.length === 1) {
          // One cursor condition.
          const [column, value] = cursorConditions[0];
          query = query.where(column, ">", value);
        } else {
          // Two cursor conditions (validated in decodeCursor).
          const [column1, value1] = cursorConditions[0];
          const [column2, value2] = cursorConditions[1];
          query = query.where(({ eb, or, and }) =>
            or([
              eb(column1, ">", value1),
              and([eb(column1, "=", value1), eb(column2, ">", value2)]),
            ]),
          );
        }

        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "sqlite"));

        const nextBefore =
          records.length > 0
            ? encodeCursor(records[0], orderByConditions)
            : null;

        if (records.length === limit + 1) {
          records.pop();
          const lastRecord = records[records.length - 1];
          const nextAfter = encodeCursor(lastRecord, orderByConditions);
          return { items: records, before: nextBefore, after: nextAfter };
        } else {
          return { items: records, before: nextBefore, after: null };
        }
      } else {
        // User provided a 'before' cursor.

        // Apply the 'before' cursor WHERE clauses.
        const cursorConditions = decodeCursor(before!, orderByConditions);
        if (cursorConditions.length === 1) {
          // One cursor condition.
          const [column, value] = cursorConditions[0];
          query = query.where(column, "<", value);
        } else {
          // Two cursor conditions (validated in decodeCursor).
          const [column1, value1] = cursorConditions[0];
          const [column2, value2] = cursorConditions[1];
          query = query.where(({ eb, or, and }) =>
            or([
              eb(column1, "<", value1),
              and([eb(column1, "=", value1), eb(column2, "<", value2)]),
            ]),
          );
        }

        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "sqlite"));

        const nextAfter =
          records.length > 0
            ? encodeCursor(records[records.length - 1], orderByConditions)
            : null;

        if (records.length === limit + 1) {
          records.shift();
          const firstRecord = records[0];
          const nextBefore = encodeCursor(firstRecord, orderByConditions);
          return { items: records, before: nextBefore, after: nextAfter };
        } else {
          return { items: records, before: null, after: nextAfter };
        }
      }
    });
  };

  create = async ({
    tableName,
    checkpoint,
    id,
    data = {},
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "create", tableName }, async () => {
      const createRow = encodeRow({ id, ...data }, table, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db
        .insertInto(versionedTableName)
        .values({
          ...createRow,
          effectiveFromCheckpoint: encodedCheckpoint,
          effectiveToCheckpoint: "latest",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return decodeRow(row, this.schema!.tables[tableName], "sqlite");
    });
  };

  createMany = async ({
    tableName,
    checkpoint,
    data,
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    data: Row[];
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "createMany", tableName }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const createRows = data.map((d) => ({
        ...encodeRow({ ...d }, table, "sqlite"),
        effectiveFromCheckpoint: encodedCheckpoint,
        effectiveToCheckpoint: "latest",
      }));

      const chunkedRows = [];
      for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
        chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

      const rows = await Promise.all(
        chunkedRows.map((c) =>
          this.db
            .insertInto(versionedTableName)
            .values(c)
            .returningAll()
            .execute(),
        ),
      );

      return rows
        .flat()
        .map((row) => decodeRow(row, this.schema!.tables[tableName], "sqlite"));
    });
  };

  update = async ({
    tableName,
    checkpoint,
    id,
    data = {},
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "update", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(versionedTableName)
          .selectAll()
          .where("id", "=", encodedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .executeTakeFirstOrThrow();

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof data === "function") {
          const current = decodeRow(latestRow, table, "sqlite");
          const updateObject = data({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, "sqlite");
        } else {
          updateRow = encodeRow({ id, ...data }, table, "sqlite");
        }

        // If the update would be applied to a record other than the latest
        // record, throw an error.
        if (latestRow.effectiveFromCheckpoint > encodedCheckpoint) {
          throw new Error("Cannot update a record in the past");
        }

        // If the latest version has the same effectiveFromCheckpoint as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effectiveFromCheckpoint === encodedCheckpoint) {
          return await tx
            .updateTable(versionedTableName)
            .set(updateRow)
            .where("id", "=", encodedId)
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(versionedTableName)
          .where("id", "=", encodedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .set({ effectiveToCheckpoint: encodedCheckpoint })
          .execute();
        const row = tx
          .insertInto(versionedTableName)
          .values({
            ...latestRow,
            ...updateRow,
            effectiveFromCheckpoint: encodedCheckpoint,
            effectiveToCheckpoint: "latest",
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return row;
      });

      const result = decodeRow(row, table, "sqlite");

      return result;
    });
  };

  updateMany = async ({
    tableName,
    checkpoint,
    where,
    data = {},
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    where: WhereInput<any>;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "updateMany", tableName }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const rows = await this.db.transaction().execute(async (tx) => {
        // Get all IDs that match the filter.
        let query = tx
          .selectFrom(versionedTableName)
          .selectAll()
          .where("effectiveToCheckpoint", "=", "latest");

        if (where) {
          const whereConditions = buildWhereConditions({
            where,
            table,
            encoding: "sqlite",
          });
          for (const [columnName, comparator, value] of whereConditions) {
            query = query.where(columnName, comparator, value);
          }
        }

        const latestRows = await query.execute();

        // TODO: This is probably incredibly slow. Ideally, we'd do most of this in the database.
        return await Promise.all(
          latestRows.map(async (latestRow) => {
            const encodedId = latestRow.id;

            // If the user passed an update function, call it with the current instance.
            let updateRow: ReturnType<typeof encodeRow>;
            let updateRow: ReturnType<typeof encodeRow>;
            if (typeof data === "function") {
              const current = decodeRow(latestRow, table, "sqlite");
              const updateObject = data({ current });
              updateRow = encodeRow(updateObject, table, "sqlite");
            } else {
              updateRow = encodeRow(data, table, "sqlite");
            }

            // If the update would be applied to a record other than the latest
            // record, throw an error.
            if (latestRow.effectiveFromCheckpoint > encodedCheckpoint) {
              throw new Error("Cannot update a record in the past");
            }

            // If the latest version has the same effectiveFrom timestamp as the update,
            // this update is occurring within the same block/second. Update in place.
            if (latestRow.effectiveFromCheckpoint === encodedCheckpoint) {
              return await tx
                .updateTable(versionedTableName)
                .set(updateRow)
                .where("id", "=", encodedId)
                .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
                .returningAll()
                .executeTakeFirstOrThrow();
            }

            // If the latest version has an earlier effectiveFromCheckpoint than the update,
            // we need to update the latest version AND insert a new version.
            await tx
              .updateTable(versionedTableName)
              .where("id", "=", encodedId)
              .where("effectiveToCheckpoint", "=", "latest")
              .set({ effectiveToCheckpoint: encodedCheckpoint })
              .execute();
            const row = tx
              .insertInto(versionedTableName)
              .values({
                ...latestRow,
                ...updateRow,
                effectiveFromCheckpoint: encodedCheckpoint,
                effectiveToCheckpoint: "latest",
              })
              .returningAll()
              .executeTakeFirstOrThrow();

            return row;
          }),
        );
      });

      return rows.map((row) => decodeRow(row, table, "sqlite"));
    });
  };

  upsert = async ({
    tableName,
    checkpoint,
    id,
    create = {},
    update = {},
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    create?: Omit<Row, "id">;
    update?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "upsert", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");
      const createRow = encodeRow({ id, ...create }, table, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(versionedTableName)
          .selectAll()
          .where("id", "=", encodedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
        if (latestRow === undefined) {
          return await tx
            .insertInto(versionedTableName)
            .values({
              ...createRow,
              effectiveFromCheckpoint: encodedCheckpoint,
              effectiveToCheckpoint: "latest",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof update === "function") {
          const current = decodeRow(latestRow, table, "sqlite");
          const updateObject = update({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, "sqlite");
        } else {
          updateRow = encodeRow({ id, ...update }, table, "sqlite");
        }

        // If the update would be applied to a record other than the latest
        // record, throw an error.
        if (latestRow.effectiveFromCheckpoint > encodedCheckpoint) {
          throw new Error("Cannot update a record in the past");
        }

        // If the latest version has the same effectiveFromCheckpoint as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effectiveFromCheckpoint === encodedCheckpoint) {
          return await tx
            .updateTable(versionedTableName)
            .set(updateRow)
            .where("id", "=", encodedId)
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(versionedTableName)
          .where("id", "=", encodedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .set({ effectiveToCheckpoint: encodedCheckpoint })
          .execute();
        const row = tx
          .insertInto(versionedTableName)
          .values({
            ...latestRow,
            ...updateRow,
            effectiveFromCheckpoint: encodedCheckpoint,
            effectiveToCheckpoint: "latest",
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return row;
      });

      return decodeRow(row, table, "sqlite");
    });
  };

  delete = async ({
    tableName,
    checkpoint,
    id,
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
  }) => {
    const versionedTableName = `${tableName}_versioned`;
    const table = this.schema!.tables[tableName];

    return this.wrap({ method: "delete", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version has effectiveFromCheckpoint equal to current checkpoint,
        // this row was created within the same indexing function, and we can delete it.
        let deletedRow = await tx
          .deleteFrom(versionedTableName)
          .where("id", "=", encodedId)
          .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
          .where("effectiveToCheckpoint", "=", "latest")
          .returning(["id"])
          .executeTakeFirst();

        // If we did not take the shortcut above, update the latest record
        // setting effectiveToCheckpoint to the current checkpoint.
        if (!deletedRow) {
          deletedRow = await tx
            .updateTable(versionedTableName)
            .set({ effectiveToCheckpoint: encodedCheckpoint })
            .where("id", "=", encodedId)
            .where("effectiveToCheckpoint", "=", "latest")
            .returning(["id"])
            .executeTakeFirst();
        }

        return !!deletedRow;
      });

      return isDeleted;
    });
  };

  private wrap = async <T>(
    options: { method: string; tableName?: string },
    fn: () => Promise<T>,
  ) => {
    const start = performance.now();
    const result = await fn();
    this.common.metrics.ponder_indexing_store_method_duration.observe(
      { method: options.method, table: options.tableName },
      performance.now() - start,
    );
    return result;
  };
}

type OrderByConditions = [column: string, direction: "asc" | "desc"][];

function encodeCursor(record: Row, orderByConditions: OrderByConditions) {
  const cursor = orderByConditions
    .map(([column]) => {
      // TODO: Properly convert value to an escaped string.
      const value = record[column]?.toString().replaceAll("|", "\\|");
      return `${column}:${value}`;
    })
    .join("|");

  return Buffer.from(cursor).toString("base64");
}

function decodeCursor(cursor: string, orderByConditions: OrderByConditions) {
  const whereConditions = Buffer.from(cursor, "base64")
    .toString()
    .split("|")
    .map((condition, index) => {
      const delimIndex = condition.indexOf(":");
      if (delimIndex === -1) {
        throw new Error(
          "Invalid cursor. Expected a delimiter ':' between column name and value.",
        );
      }
      const column = condition.slice(0, delimIndex);
      const value = condition.slice(delimIndex + 1);
      if (column !== orderByConditions[index][0]) {
        throw new Error(
          `Invalid cursor. Expected column '${orderByConditions[index][0]}', received '${column}'.`,
        );
      }

      // TODO: Validate and convert value to the correct type.
      const decodedValue = value as string | number | bigint;

      return [column, decodedValue] as const;
    });

  if (whereConditions.length > 2) {
    throw new Error("Invalid cursor. Expected 1 or 2 conditions.");
  }

  if (whereConditions.length !== orderByConditions.length) {
    throw new Error(
      `Invalid cursor. Expected ${orderByConditions.length} conditions, received ${whereConditions.length}`,
    );
  }

  return whereConditions;
}
