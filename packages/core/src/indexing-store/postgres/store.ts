import { CompiledQuery, Kysely, PostgresDialect, sql } from "kysely";

import type { Common } from "@/Ponder.js";
import type { Scalar, Schema } from "@/schema/types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
} from "@/schema/utils.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { Pool } from "@/utils/pg.js";

import type { IndexingStore, OrderByInput, Row, WhereInput } from "../store.js";
import { formatColumnValue, formatRow } from "../utils/format.js";
import { validateSkip, validateTake } from "../utils/pagination.js";
import {
  buildSqlOrderByConditions,
  buildSqlWhereConditions,
} from "../utils/where.js";

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
  kind = "postgres" as const;
  private common: Common;

  db: Kysely<any>;

  schema?: Schema;

  constructor({
    common,
    pool,
    databaseSchema,
  }: {
    common: Common;
    pool: Pool;
    databaseSchema?: string;
  }) {
    this.common = common;
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
    return this.wrap({ method: "findUnique", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: false,
      });

      let query = this.db
        .selectFrom(table)
        .selectAll()
        .where(
          "id",
          this.idColumnComparator({ tableName, schema: this.schema }),
          formattedId,
        );

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

      return this.deserializeRow({ tableName, row });
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
      const createRow = formatRow({ id, ...data }, false);
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

      return this.deserializeRow({ tableName, row });
    });
  };

  createMany = async ({
    tableName,
    checkpoint,
    data,
  }: {
    tableName: string;
    checkpoint: Checkpoint;
    id: string | number | bigint;
    data: Row[];
  }) => {
    return this.wrap({ method: "createMany", tableName }, async () => {
      const table = `${tableName}_versioned`;
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const createRows = data.map((d) => ({
        ...formatRow({ ...d }, false),
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

      return rows.flat().map((row) => this.deserializeRow({ tableName, row }));
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
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: false,
      });
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(table)
          .selectAll()
          .where(
            "id",
            this.idColumnComparator({ tableName, schema: this.schema }),
            formattedId,
          )
          .where("effectiveToCheckpoint", "=", "latest")
          .executeTakeFirstOrThrow();

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof formatRow>;
        if (typeof data === "function") {
          const current = this.deserializeRow({ tableName, row: latestRow });
          const updateObject = data({ current });
          updateRow = formatRow({ id, ...updateObject }, false);
        } else {
          updateRow = formatRow({ id, ...data }, false);
        }

        // If the update would be applied to a record other than the latest
        // record, throw an error.
        if (latestRow.effectiveFromCheckpoint > encodedCheckpoint) {
          throw new Error(`Cannot update a record in the past`);
        }

        // If the latest version has the same effectiveFromCheckpoint as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effectiveFromCheckpoint === encodedCheckpoint) {
          return await tx
            .updateTable(table)
            .set(updateRow)
            .where(
              "id",
              this.idColumnComparator({ tableName, schema: this.schema }),
              formattedId,
            )
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        const [, row] = await Promise.all([
          tx
            .updateTable(table)
            .where(
              "id",
              this.idColumnComparator({ tableName, schema: this.schema }),
              formattedId,
            )
            .where("effectiveToCheckpoint", "=", "latest")
            .set({ effectiveToCheckpoint: encodedCheckpoint })
            .execute(),
          tx
            .insertInto(table)
            .values({
              ...latestRow,
              ...updateRow,
              effectiveFromCheckpoint: encodedCheckpoint,
              effectiveToCheckpoint: "latest",
            })
            .returningAll()
            .executeTakeFirstOrThrow(),
        ]);

        return row;
      });

      const result = this.deserializeRow({ tableName, row });

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

            // If the user passed an update function, call it with the current instance.
            let updateRow: ReturnType<typeof formatRow>;
            if (typeof data === "function") {
              const current = this.deserializeRow({
                tableName,
                row: latestRow,
              });
              const updateObject = data({ current });
              updateRow = formatRow(updateObject, false);
            } else {
              updateRow = formatRow(data, false);
            }

            // If the update would be applied to a record other than the latest
            // record, throw an error.
            if (latestRow.effectiveFromCheckpoint > encodedCheckpoint) {
              throw new Error(`Cannot update a record in the past`);
            }

            // If the latest version has the same effectiveFrom timestamp as the update,
            // this update is occurring within the same block/second. Update in place.
            if (latestRow.effectiveFromCheckpoint === encodedCheckpoint) {
              return await tx
                .updateTable(table)
                .set(updateRow)
                .where(
                  "id",
                  this.idColumnComparator({ tableName, schema: this.schema }),
                  formattedId,
                )
                .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
                .returningAll()
                .executeTakeFirstOrThrow();
            }

            // If the latest version has an earlier effectiveFromCheckpoint than the update,
            // we need to update the latest version AND insert a new version.
            const [, row] = await Promise.all([
              tx
                .updateTable(table)
                .where(
                  "id",
                  this.idColumnComparator({ tableName, schema: this.schema }),
                  formattedId,
                )
                .where("effectiveToCheckpoint", "=", "latest")
                .set({ effectiveToCheckpoint: encodedCheckpoint })
                .execute(),
              tx
                .insertInto(table)
                .values({
                  ...latestRow,
                  ...updateRow,
                  effectiveFromCheckpoint: encodedCheckpoint,
                  effectiveToCheckpoint: "latest",
                })
                .returningAll()
                .executeTakeFirstOrThrow(),
            ]);

            return row;
          }),
        );
      });

      return rows.map((row) => this.deserializeRow({ tableName, row }));
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
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: false,
      });
      const createRow = formatRow({ id, ...create }, false);
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(table)
          .selectAll()
          .where(
            "id",
            this.idColumnComparator({ tableName, schema: this.schema }),
            formattedId,
          )
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
        let updateRow: ReturnType<typeof formatRow>;
        if (typeof update === "function") {
          const current = this.deserializeRow({ tableName, row: latestRow });
          const updateObject = update({ current });
          updateRow = formatRow({ id, ...updateObject }, false);
        } else {
          updateRow = formatRow({ id, ...update }, false);
        }

        // If the update would be applied to a record other than the latest
        // record, throw an error.
        if (latestRow.effectiveFromCheckpoint > encodedCheckpoint) {
          throw new Error(`Cannot update a record in the past`);
        }

        // If the latest version has the same effectiveFromCheckpoint as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effectiveFromCheckpoint === encodedCheckpoint) {
          return await tx
            .updateTable(table)
            .set(updateRow)
            .where(
              "id",
              this.idColumnComparator({ tableName, schema: this.schema }),
              formattedId,
            )
            .where("effectiveFromCheckpoint", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effectiveFromCheckpoint than the update,
        // we need to update the latest version AND insert a new version.
        const [, row] = await Promise.all([
          tx
            .updateTable(table)
            .where(
              "id",
              this.idColumnComparator({ tableName, schema: this.schema }),
              formattedId,
            )
            .where("effectiveToCheckpoint", "=", "latest")
            .set({ effectiveToCheckpoint: encodedCheckpoint })
            .execute(),
          tx
            .insertInto(table)
            .values({
              ...latestRow,
              ...updateRow,
              effectiveFromCheckpoint: encodedCheckpoint,
              effectiveToCheckpoint: "latest",
            })
            .returningAll()
            .executeTakeFirstOrThrow(),
        ]);

        return row;
      });

      return this.deserializeRow({ tableName, row });
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
      const formattedId = formatColumnValue({
        value: id,
        encodeBigInts: false,
      });
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version has effectiveFromCheckpoint equal to current checkpoint,
        // this row was created within the same indexing function, and we can delete it.
        let deletedRow = await tx
          .deleteFrom(table)
          .where(
            "id",
            this.idColumnComparator({ tableName, schema: this.schema }),
            formattedId,
          )
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
            .where(
              "id",
              this.idColumnComparator({ tableName, schema: this.schema }),
              formattedId,
            )
            .where("effectiveToCheckpoint", "=", "latest")
            .returning(["id"])
            .executeTakeFirst();
        }

        return !!deletedRow;
      });

      return isDeleted;
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
        deserializedRow[columnName] = value;
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
    const result = await fn();
    this.common.metrics.ponder_indexing_store_method_duration.observe(
      { method: options.method, table: options.tableName },
      performance.now() - start,
    );
    return result;
  };

  private idColumnComparator = ({
    tableName,
    schema,
  }: {
    tableName: string;
    schema: Schema | undefined;
  }) => (schema?.tables[tableName]?.id.type === "bytes" ? "ilike" : "=");
}
