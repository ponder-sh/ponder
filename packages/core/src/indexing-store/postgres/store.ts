import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import { Kysely, PostgresDialect, WithSchemaPlugin, sql } from "kysely";
import type { Pool } from "pg";
import type { IndexingStore, OrderByInput, Row, WhereInput } from "../store.js";
import {
  buildCursorConditions,
  decodeCursor,
  encodeCursor,
} from "../utils/cursor.js";
import { decodeRow, encodeRow, encodeValue } from "../utils/encoding.js";
import { buildWhereConditions } from "../utils/filter.js";
import {
  buildOrderByConditions,
  reverseOrderByConditions,
} from "../utils/sort.js";

const MAX_BATCH_SIZE = 1_000 as const;

const DEFAULT_LIMIT = 50 as const;
const MAX_LIMIT = 1_000 as const;

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;

export class PostgresIndexingStore implements IndexingStore {
  kind = "postgres" as const;
  private common: Common;

  db: Kysely<any>;
  schema?: Schema;

  private databaseSchemaName: string;

  constructor({
    common,
    pool,
    usePublic = false,
  }: { common: Common; pool: Pool; usePublic?: boolean }) {
    this.databaseSchemaName = usePublic
      ? "public"
      : `ponder_${new Date().getTime()}`;
    this.common = common;

    this.common.logger.debug({
      msg: `Using schema '${this.databaseSchemaName}'`,
      service: "indexing",
    });

    this.db = new Kysely({
      dialect: new PostgresDialect({ pool }),
      log(event) {
        if (event.level === "query")
          common.metrics.ponder_postgres_query_count?.inc({ kind: "indexing" });
      },
    }).withPlugin(new WithSchemaPlugin(this.databaseSchemaName));
  }

  async teardown() {
    if (this.databaseSchemaName === "public") return;
    return this.wrap({ method: "teardown" }, async () => {
      await this.db.schema
        .dropSchema(this.databaseSchemaName)
        .ifExists()
        .cascade()
        .execute();
    });
  }

  kill = async () => {
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
  };

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
        await tx.schema
          .createSchema(this.databaseSchemaName)
          .ifNotExists()
          .execute();

        // Create tables for new schema.
        await Promise.all(
          Object.entries(this.schema!.tables).map(
            async ([tableName, columns]) => {
              const table = `${tableName}_versioned`;

              // Drop existing table with the same name if it exists.
              // Note that "cascade" here will drop the views in the public schema
              // if the current schema has been published.
              await tx.schema.dropTable(table).ifExists().cascade().execute();

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
        // Create views in the public schema pointing at tables in the private schema.
        await Promise.all(
          Object.entries(this.schema!.tables).map(
            async ([tableName, columns]) => {
              await tx.schema
                .withSchema("public")
                .dropView(`${tableName}_versioned`)
                .ifExists()
                .execute();
              await tx.schema
                .withSchema("public")
                .createView(`${tableName}_versioned`)
                .as(
                  tx
                    .withSchema(this.databaseSchemaName)
                    .selectFrom(`${tableName}_versioned`)
                    .selectAll(),
                )
                .execute();

              const columnNames = Object.entries(columns)
                .filter(([, c]) => !isOneColumn(c) && !isManyColumn(c))
                .map(([name]) => name);
              await tx.schema
                .withSchema("public")
                .dropView(tableName)
                .ifExists()
                .execute();
              await tx.schema
                .withSchema("public")
                .createView(tableName)
                .as(
                  tx
                    .withSchema(this.databaseSchemaName)
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

            // Delete any versions that are newer than the safe checkpoint.
            await tx
              .deleteFrom(table)
              .where("effectiveFromCheckpoint", ">=", encodedCheckpoint)
              .execute();

            // Now, any versions with effectiveToCheckpoint greater than or equal
            // to the safe checkpoint are the new latest version.
            await tx
              .updateTable(table)
              .where("effectiveToCheckpoint", ">=", encodedCheckpoint)
              .set({ effectiveToCheckpoint: "latest" })
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
      const formattedId = encodeValue(id, table.id, "postgres");

      let query = this.db
        .selectFrom(versionedTableName)
        .selectAll()
        .where("id", "=", formattedId);

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

      return decodeRow(row, table, "postgres");
    });
  };

  findMany = async ({
    tableName,
    checkpoint = "latest",
    where,
    orderBy,
    before = null,
    after = null,
    limit = DEFAULT_LIMIT,
  }: {
    tableName: string;
    checkpoint?: Checkpoint | "latest";
    where?: WhereInput<any>;
    orderBy?: OrderByInput<any>;
    before?: string | null;
    after?: string | null;
    limit?: number;
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
        query = query.where((eb) =>
          buildWhereConditions({ eb, where, table, encoding: "postgres" }),
        );
      }

      const orderByConditions = buildOrderByConditions({ orderBy, table });
      for (const [column, direction] of orderByConditions) {
        query = query.orderBy(
          column,
          direction === "asc" || direction === undefined
            ? sql`asc nulls first`
            : sql`desc nulls last`,
        );
      }
      const orderDirection = orderByConditions[0][1];

      if (limit > MAX_LIMIT) {
        throw new Error(
          `Invalid limit. Got ${limit}, expected <=${MAX_LIMIT}.`,
        );
      }

      let startCursor = null;
      let endCursor = null;
      let hasPreviousPage = false;
      let hasNextPage = false;

      // Neither cursors are specified, apply the order conditions and execute.
      if (after === null && before === null) {
        query = query.limit(limit + 1);
        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "postgres"));

        if (records.length === limit + 1) {
          records.pop();
          hasNextPage = true;
        }

        startCursor =
          records.length > 0
            ? encodeCursor(records[0], orderByConditions)
            : null;
        endCursor =
          records.length > 0
            ? encodeCursor(records[records.length - 1], orderByConditions)
            : null;

        return {
          items: records,
          pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
        };
      }

      if (after !== null) {
        // User specified an 'after' cursor.
        const rawCursorValues = decodeCursor(after, orderByConditions);
        const cursorValues = rawCursorValues.map(([columnName, value]) => [
          columnName,
          encodeValue(value, table[columnName], "postgres"),
        ]) satisfies [string, any][];
        query = query
          .where((eb) =>
            buildCursorConditions(cursorValues, "after", orderDirection, eb),
          )
          .limit(limit + 2);

        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "postgres"));

        if (records.length === 0) {
          return {
            items: records,
            pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
          };
        }

        // If the cursor of the first returned record equals the `after` cursor,
        // `hasPreviousPage` is true. Remove that record.
        if (encodeCursor(records[0], orderByConditions) === after) {
          records.shift();
          hasPreviousPage = true;
        } else {
          // Otherwise, remove the last record.
          records.pop();
        }

        // Now if the length of the records is still equal to limit + 1,
        // there is a next page.
        if (records.length === limit + 1) {
          records.pop();
          hasNextPage = true;
        }

        // Now calculate the cursors.
        startCursor =
          records.length > 0
            ? encodeCursor(records[0], orderByConditions)
            : null;
        endCursor =
          records.length > 0
            ? encodeCursor(records[records.length - 1], orderByConditions)
            : null;

        return {
          items: records,
          pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
        };
      } else {
        // User specified a 'before' cursor.
        const rawCursorValues = decodeCursor(before!, orderByConditions);
        const cursorValues = rawCursorValues.map(([columnName, value]) => [
          columnName,
          encodeValue(value, table[columnName], "postgres"),
        ]) satisfies [string, any][];
        query = query
          .where((eb) =>
            buildCursorConditions(cursorValues, "before", orderDirection, eb),
          )
          .limit(limit + 2);

        // Reverse the order by conditions to get the previous page.
        query = query.clearOrderBy();
        const reversedOrderByConditions =
          reverseOrderByConditions(orderByConditions);
        for (const [column, direction] of reversedOrderByConditions) {
          query = query.orderBy(column, direction);
        }

        const rows = await query.execute();
        const records = rows
          .map((row) => decodeRow(row, table, "postgres"))
          // Reverse the records again, back to the original order.
          .reverse();

        if (records.length === 0) {
          return {
            items: records,
            pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
          };
        }

        // If the cursor of the last returned record equals the `before` cursor,
        // `hasNextPage` is true. Remove that record.
        if (
          encodeCursor(records[records.length - 1], orderByConditions) ===
          before
        ) {
          records.pop();
          hasNextPage = true;
        } else {
          // Otherwise, remove the first record.
          records.shift();
        }

        // Now if the length of the records is equal to limit + 1, we know
        // there is a previous page.
        if (records.length === limit + 1) {
          records.shift();
          hasPreviousPage = true;
        }

        // Now calculate the cursors.
        startCursor =
          records.length > 0
            ? encodeCursor(records[0], orderByConditions)
            : null;
        endCursor =
          records.length > 0
            ? encodeCursor(records[records.length - 1], orderByConditions)
            : null;

        return {
          items: records,
          pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
        };
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
      const createRow = encodeRow({ id, ...data }, table, "postgres");
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

      return decodeRow(row, table, "postgres");
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
        ...encodeRow({ ...d }, table, "postgres"),
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

      return rows.flat().map((row) => decodeRow(row, table, "postgres"));
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
      const formattedId = encodeValue(id, table.id, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(versionedTableName)
          .selectAll()
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .executeTakeFirstOrThrow();

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof data === "function") {
          const current = decodeRow(latestRow, table, "postgres");
          const updateObject = data({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, "postgres");
        } else {
          updateRow = encodeRow({ id, ...data }, table, "postgres");
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
            .where("id", "=", formattedId)
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(versionedTableName)
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .set({ effectiveToCheckpoint: encodedCheckpoint })
          .execute();
        const row = await tx
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

      const result = decodeRow(row, table, "postgres");

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
          query = query.where((eb) =>
            buildWhereConditions({
              eb,
              where,
              table,
              encoding: "postgres",
            }),
          );
        }

        const latestRows = await query.execute();

        // TODO: This is probably incredibly slow. Ideally, we'd do most of this in the database.
        return await Promise.all(
          latestRows.map(async (latestRow) => {
            const formattedId = latestRow.id;

            // If the user passed an update function, call it with the current instance.
            let updateRow: ReturnType<typeof encodeRow>;
            if (typeof data === "function") {
              const current = decodeRow(latestRow, table, "postgres");
              const updateObject = data({ current });
              updateRow = encodeRow(updateObject, table, "postgres");
            } else {
              updateRow = encodeRow(data, table, "postgres");
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
                .where("id", "=", formattedId)
                .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
                .returningAll()
                .executeTakeFirstOrThrow();
            }

            // If the latest version has an earlier effectiveFromCheckpoint than the update,
            // we need to update the latest version AND insert a new version.
            await tx
              .updateTable(versionedTableName)
              .where("id", "=", formattedId)
              .where("effectiveToCheckpoint", "=", "latest")
              .set({ effectiveToCheckpoint: encodedCheckpoint })
              .execute();
            const row = await tx
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

      return rows.map((row) => decodeRow(row, table, "postgres"));
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
      const formattedId = encodeValue(id, table.id, "postgres");
      const createRow = encodeRow({ id, ...create }, table, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(versionedTableName)
          .selectAll()
          .where("id", "=", formattedId)
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
        if (typeof update === "function") {
          const current = decodeRow(latestRow, table, "postgres");
          const updateObject = update({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, "postgres");
        } else {
          updateRow = encodeRow({ id, ...update }, table, "postgres");
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
            .where("id", "=", formattedId)
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(versionedTableName)
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .set({ effectiveToCheckpoint: encodedCheckpoint })
          .execute();
        const row = await tx
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

      return decodeRow(row, table, "postgres");
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
      const formattedId = encodeValue(id, table.id, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version has effectiveFromCheckpoint equal to current checkpoint,
        // this row was created within the same indexing function, and we can delete it.
        let deletedRow = await tx
          .deleteFrom(versionedTableName)
          .where("id", "=", formattedId)
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
            .where("id", "=", formattedId)
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
