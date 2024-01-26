import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import { Kysely, SqliteDialect, sql } from "kysely";
import type { IndexingStore, OrderByInput, Row, WhereInput } from "../store.js";
import { decodeRow, encodeRow, encodeValue } from "../utils/encoding.js";
import { validateSkip, validateTake } from "../utils/pagination.js";
import {
  buildSqlOrderByConditions,
  buildSqlOrderByConditionsReversed,
  buildSqlWhereConditions,
} from "../utils/where.js";

const MAX_BATCH_SIZE = 1_000 as const;

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
    return this.wrap({ method: "findUnique", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = encodeValue(
        id,
        this.schema!.tables[tableName].id,
        "sqlite",
      );

      let query = this.db
        .selectFrom(table)
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

      return decodeRow(row, this.schema!.tables[tableName], "sqlite");
    });
  };

  findMany = async ({
    tableName,
    checkpoint = "latest",
    where,
    skip,
    take,
    orderBy,
  }: {
    tableName: string;
    checkpoint?: Checkpoint | "latest";
    where?: WhereInput<any>;
    skip?: number;
    take?: number;
    orderBy?: OrderByInput<any>;
  }) => {
    return this.wrap({ method: "findMany", tableName }, async () => {
      const table = `${tableName}_versioned`;

      let query = this.db.selectFrom(table).selectAll();

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
      return rows.map((row) =>
        decodeRow(row, this.schema!.tables[tableName], "sqlite"),
      );
    });
  };

  /*
   * To determine correct sorting where rows =
   * [
   *    id: 0,
   *    id: 1,
   *    id: 2,
   *    id: 3,
   * ]
   *
   * If no after or before arguments, then sort as is;
   *
   * If after argument,
   *   1) sort in same order as passed in
   *   2) or if no orderBy argument sort as ascending;
   *
   * If before argument, then since our query needs to fetch in reverse
   * (select * from x where id < before) we need to
   *   1) make orderBy the opposite of the orderBy the user passed in and
   *      then reverse() the results
   *   2) or if no orderBy argument, sort in descending;
   *
   * after {id : 1} : (select * from x where id > before order by 'asc')
   * [
   *    id: 2,
   *    id: 3,
   * ]
   *
   * before { id: 2} : (select * from x where id < before order by 'desc')
   * 1)
   * [
   *    id: 1,
   *    id: 0
   * ]
   * 2) reverse()
   * [
   *    id: 0,
   *    id: 1
   * ]
   */

  findManyPaginated = async ({
    tableName,
    checkpoint = "latest",
    where,
    before,
    after,
    take,
    orderBy,
  }: {
    tableName: string;
    checkpoint?: Checkpoint | "latest";
    where?: WhereInput<any>;
    before?: string;
    after?: string;
    take?: number;
    orderBy?: OrderByInput<any>;
  }) => {
    return this.wrap({ method: "findMany", tableName }, async () => {
      const table = `${tableName}_versioned`;

      let query = this.db.selectFrom(table).selectAll();

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
        const whereConditions = buildSqlWhereConditions({
          where,
          encodeBigInts: true,
        });
        for (const whereCondition of whereConditions) {
          query = query.where(...whereCondition);
        }
      }

      if (take) {
        const limit = validateTake(take);
        // Get +1 extra row to determine if has next
        query = query.limit(limit + 1);
      }

      let orderDirection = "asc";

      if (orderBy) {
        // Get reversed order conditions, for finding the -1 row
        const orderByConditions = !before
          ? buildSqlOrderByConditions({ orderBy })
          : buildSqlOrderByConditionsReversed({ orderBy });

        orderDirection = orderByConditions[0][1];

        for (const orderByCondition of orderByConditions) {
          query = query.orderBy(...orderByCondition);
        }
        //query = query.orderBy(`id ${orderDirection}`);
      }

      const { rows } = await this.db.transaction().execute(async (tx) => {
        if (!!before || !!after) {
          const currentRowQuery = this.db
            .selectFrom(table)
            .selectAll()
            .limit(1)
            .where(
              "id",
              "=",
              Buffer.from(after || before || "", "base64").toString(),
            );
          const res = await tx.executeQuery(currentRowQuery);

          const dir = orderDirection === "desc" ? "<" : ">";

          if (orderBy && !!res?.rows?.length) {
            const orderByKey = Object.keys(orderBy)[0];
            if (orderByKey !== "id") {
              const resAny = res as any;
              const orderByValue = resAny.rows[0][orderByKey];

              // Account for ordering by another column besides ID by adding a secondary where -
              // "where orderByKey > orderByValue or (orderByKey = orderByValue and id > currentId)"
              query = query.where((eb) =>
                eb(orderByKey, dir, resAny.rows[0][orderByKey]).or(
                  eb.and([
                    eb(orderByKey, "=", orderByValue),
                    eb("id", dir, resAny.rows[0].id),
                  ]),
                ),
              );
              // Account for only id ordering - don't need any secondary ordering
            } else {
              const resAny = res as any;
              query = query.where((eb) =>
                eb(orderByKey, dir, resAny.rows[0][orderByKey]),
              );
            }
          }
        }

        const selectQuery = await tx.executeQuery(query);
        return { rows: selectQuery.rows };
      });

      let deserializedRows = rows.map((row) =>
        this.deserializeRow({ tableName, row }),
      );
      if (before) {
        deserializedRows.reverse();
      }

      const hasAfter = rows.length > (take || 1000);

      if (hasAfter && before) {
        deserializedRows = deserializedRows.slice(1);
      }

      if (hasAfter && !before) {
        deserializedRows = deserializedRows.slice(0, -1);
      }

      return {
        before: after
          ? Buffer.from(deserializedRows[0].id.toString()).toString("base64")
          : hasAfter && before
            ? Buffer.from(deserializedRows[0].id.toString()).toString("base64")
            : null,
        after: before
          ? Buffer.from(
              deserializedRows[deserializedRows.length - 1].id.toString(),
            ).toString("base64")
          : hasAfter
            ? Buffer.from(
                deserializedRows[deserializedRows.length - 1].id.toString(),
              ).toString("base64")
            : null,
        rows: deserializedRows,
      };
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
    return this.wrap({ method: "create", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const createRow = encodeRow(
        { id, ...data },
        this.schema!.tables[tableName],
        "sqlite",
      );
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db
        .insertInto(table)
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
    return this.wrap({ method: "createMany", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const createRows = data.map((d) => ({
        ...encodeRow({ ...d }, this.schema!.tables[tableName], "sqlite"),
        effectiveFromCheckpoint: encodedCheckpoint,
        effectiveToCheckpoint: "latest",
      }));

      const chunkedRows = [];
      for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
        chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

      const rows = await Promise.all(
        chunkedRows.map((c) =>
          this.db.insertInto(table).values(c).returningAll().execute(),
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
    return this.wrap({ method: "update", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const tableSchema = this.schema!.tables[tableName];
      const formattedId = encodeValue(id, tableSchema.id, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(table)
          .selectAll()
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .executeTakeFirstOrThrow();

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof data === "function") {
          const current = decodeRow(latestRow, tableSchema, "sqlite");
          const updateObject = data({ current });
          updateRow = encodeRow({ id, ...updateObject }, tableSchema, "sqlite");
        } else {
          updateRow = encodeRow({ id, ...data }, tableSchema, "sqlite");
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
            .updateTable(table)
            .set(updateRow)
            .where("id", "=", formattedId)
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(table)
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .set({ effectiveToCheckpoint: encodedCheckpoint })
          .execute();
        const row = tx
          .insertInto(table)
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

      const result = decodeRow(row, tableSchema, "sqlite");

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
    return this.wrap({ method: "updateMany", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const tableSchema = this.schema!.tables[tableName];
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const rows = await this.db.transaction().execute(async (tx) => {
        // Get all IDs that match the filter.
        let latestRowsQuery = tx
          .selectFrom(table)
          .selectAll()
          .where("effectiveToCheckpoint", "=", "latest");

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
            let updateRow: ReturnType<typeof encodeRow>;
            if (typeof data === "function") {
              const current = decodeRow(latestRow, tableSchema, "sqlite");
              const updateObject = data({ current });
              updateRow = encodeRow(updateObject, tableSchema, "sqlite");
            } else {
              updateRow = encodeRow(data, tableSchema, "sqlite");
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
                .updateTable(table)
                .set(updateRow)
                .where("id", "=", formattedId)
                .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
                .returningAll()
                .executeTakeFirstOrThrow();
            }

            // If the latest version has an earlier effectiveFromCheckpoint than the update,
            // we need to update the latest version AND insert a new version.
            await tx
              .updateTable(table)
              .where("id", "=", formattedId)
              .where("effectiveToCheckpoint", "=", "latest")
              .set({ effectiveToCheckpoint: encodedCheckpoint })
              .execute();
            const row = tx
              .insertInto(table)
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

      return rows.map((row) => decodeRow(row, tableSchema, "sqlite"));
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
    return this.wrap({ method: "upsert", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const tableSchema = this.schema!.tables[tableName];
      const formattedId = encodeValue(id, tableSchema.id, "sqlite");
      const createRow = encodeRow({ id, ...create }, tableSchema, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(table)
          .selectAll()
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
        if (latestRow === undefined) {
          return await tx
            .insertInto(table)
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
          const current = decodeRow(latestRow, tableSchema, "sqlite");
          const updateObject = update({ current });
          updateRow = encodeRow({ id, ...updateObject }, tableSchema, "sqlite");
        } else {
          updateRow = encodeRow({ id, ...update }, tableSchema, "sqlite");
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
            .updateTable(table)
            .set(updateRow)
            .where("id", "=", formattedId)
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(table)
          .where("id", "=", formattedId)
          .where("effectiveToCheckpoint", "=", "latest")
          .set({ effectiveToCheckpoint: encodedCheckpoint })
          .execute();
        const row = tx
          .insertInto(table)
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

      return decodeRow(row, tableSchema, "sqlite");
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
    return this.wrap({ method: "delete", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = encodeValue(
        id,
        this.schema!.tables[tableName].id,
        "sqlite",
      );
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version has effectiveFromCheckpoint equal to current checkpoint,
        // this row was created within the same indexing function, and we can delete it.
        let deletedRow = await tx
          .deleteFrom(table)
          .where("id", "=", formattedId)
          .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
          .where("effectiveToCheckpoint", "=", "latest")
          .returning(["id"])
          .executeTakeFirst();

        // If we did not take the shortcut above, update the latest record
        // setting effectiveToCheckpoint to the current checkpoint.
        if (!deletedRow) {
          deletedRow = await tx
            .updateTable(table)
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
