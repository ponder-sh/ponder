import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import { Kysely, SqliteDialect } from "kysely";
import type { IndexingStore, OrderByInput, Row, WhereInput } from "../store.js";
import {
  buildCursorConditions,
  decodeCursor,
  encodeCursor,
} from "../utils/cursor.js";
import { decodeRow, encodeRow, encodeValue } from "../utils/encoding.js";
import { buildWhereConditions } from "../utils/filter.js";
import { revertTable } from "../utils/revert.js";
import {
  buildOrderByConditions,
  reverseOrderByConditions,
} from "../utils/sort.js";

const MAX_BATCH_SIZE = 1_000 as const;

const DEFAULT_LIMIT = 50 as const;
const MAX_LIMIT = 1_000 as const;

export class SqliteIndexingStore implements IndexingStore {
  kind = "sqlite" as const;
  private common: Common;

  db: Kysely<any>;
  schema: Schema;

  constructor({
    common,
    database,
    schema,
  }: {
    common: Common;
    database: SqliteDatabase;
    schema: Schema;
  }) {
    this.common = common;
    this.schema = schema;
    this.db = new Kysely({
      dialect: new SqliteDialect({ database }),
      log(event) {
        if (event.level === "query")
          common.metrics.ponder_sqlite_query_count?.inc({ kind: "indexing" });
      },
    });
  }

  /**
   * Revert any changes that occurred during or after the specified checkpoint.
   */
  revert = async ({ checkpoint }: { checkpoint: Checkpoint }) => {
    return this.wrap({ method: "revert" }, async () => {
      await this.db
        .transaction()
        .execute((tx) =>
          Promise.all(
            Object.keys(this.schema?.tables ?? {}).map(async (tableName) =>
              revertTable(tx, tableName, checkpoint),
            ),
          ),
        );
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "findUnique", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");

      let query = this.db
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", encodedId);

      if (checkpoint === "latest") {
        query = query.where("effective_to", "=", "latest");
      } else {
        const encodedCheckpoint = encodeCheckpoint(checkpoint);
        query = query
          .where("effective_from", "<=", encodedCheckpoint)
          .where(({ eb, or }) =>
            or([
              eb("effective_to", ">", encodedCheckpoint),
              eb("effective_to", "=", "latest"),
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "findMany", tableName }, async () => {
      let query = this.db.selectFrom(tableName).selectAll();

      if (checkpoint === "latest") {
        query = query.where("effective_to", "=", "latest");
      } else {
        const encodedCheckpoint = encodeCheckpoint(checkpoint);
        query = query
          .where("effective_from", "<=", encodedCheckpoint)
          .where(({ eb, or }) =>
            or([
              eb("effective_to", ">", encodedCheckpoint),
              eb("effective_to", "=", "latest"),
            ]),
          );
      }

      if (where) {
        query = query.where((eb) =>
          buildWhereConditions({ eb, where, table, encoding: "sqlite" }),
        );
      }

      const orderByConditions = buildOrderByConditions({ orderBy, table });
      for (const [column, direction] of orderByConditions) {
        query = query.orderBy(column, direction);
      }
      const orderDirection = orderByConditions[0][1];

      if (limit > MAX_LIMIT) {
        throw new Error(
          `Invalid limit. Got ${limit}, expected <=${MAX_LIMIT}.`,
        );
      }

      if (after !== null && before !== null) {
        throw new Error("Cannot specify both before and after cursors.");
      }

      let startCursor = null;
      let endCursor = null;
      let hasPreviousPage = false;
      let hasNextPage = false;

      // Neither cursors are specified, apply the order conditions and execute.
      if (after === null && before === null) {
        query = query.limit(limit + 1);
        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "sqlite"));

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
          encodeValue(value, table[columnName], "sqlite"),
        ]) satisfies [string, any][];
        query = query
          .where((eb) =>
            buildCursorConditions(cursorValues, "after", orderDirection, eb),
          )
          .limit(limit + 2);

        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "sqlite"));

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
          encodeValue(value, table[columnName], "sqlite"),
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
          .map((row) => decodeRow(row, table, "sqlite"))
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "create", tableName }, async () => {
      const createRow = encodeRow({ id, ...data }, table, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      try {
        const row = await this.db
          .insertInto(tableName)
          .values({
            ...createRow,
            effective_from: encodedCheckpoint,
            effective_to: "latest",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return decodeRow(row, table, "sqlite");
      } catch (err) {
        const error = err as Error;
        throw error.message.includes("UNIQUE constraint failed")
          ? new Error(
              `Cannot create ${tableName} record with ID ${id} because a record already exists with that ID (UNIQUE constraint violation). Hint: Did you forget to await the promise returned by a store method? Or, consider using ${tableName}.upsert().`,
            )
          : error;
      }
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "createMany", tableName }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const createRows = data.map((d) => ({
        ...encodeRow({ ...d }, table, "sqlite"),
        effective_from: encodedCheckpoint,
        effective_to: "latest",
      }));

      const chunkedRows = [];
      for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
        chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

      try {
        const rows = await Promise.all(
          chunkedRows.map((c) =>
            this.db.insertInto(tableName).values(c).returningAll().execute(),
          ),
        );

        return rows.flat().map((row) => decodeRow(row, table, "sqlite"));
      } catch (err) {
        const error = err as Error;
        throw error.message.includes("UNIQUE constraint failed")
          ? new Error(
              `Cannot createMany ${tableName} records because one or more records already exist (UNIQUE constraint violation). Hint: Did you forget to await the promise returned by a store method?`,
            )
          : error;
      }
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "update", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .where("effective_to", "=", "latest")
          .executeTakeFirst();
        if (!latestRow)
          throw new Error(
            `Cannot update ${tableName} record with ID ${id} because no existing record was found with that ID. Consider using ${tableName}.upsert(), or create the record before updating it. Hint: Did you forget to await the promise returned by a store method?`,
          );

        // If the user passed an update function, call it with the current instance.
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
        if (latestRow.effective_from > encodedCheckpoint)
          throw new Error(
            `Cannot update ${tableName} record with ID ${id} at checkpoint ${encodedCheckpoint} because there is a newer version of the record at checkpoint ${latestRow.effective_from}. Hint: Did you forget to await the promise returned by a store method?`,
          );

        // If the latest version has the same effective_from as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effective_from === encodedCheckpoint) {
          return await tx
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", encodedId)
            .where("effective_from", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effective_from than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(tableName)
          .where("id", "=", encodedId)
          .where("effective_to", "=", "latest")
          .set({ effective_to: encodedCheckpoint })
          .execute();
        return tx
          .insertInto(tableName)
          .values({
            ...latestRow,
            ...updateRow,
            effective_from: encodedCheckpoint,
            effective_to: "latest",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "updateMany", tableName }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const rows = await this.db.transaction().execute(async (tx) => {
        // Get all IDs that match the filter.
        let query = tx
          .selectFrom(tableName)
          .selectAll()
          .where("effective_to", "=", "latest");

        if (where) {
          query = query.where((eb) =>
            buildWhereConditions({
              eb,
              where,
              table,
              encoding: "sqlite",
            }),
          );
        }

        const latestRows = await query.execute();

        // TODO: This is probably incredibly slow. Ideally, we'd do most of this in the database.
        return await Promise.all(
          latestRows.map(async (latestRow) => {
            const encodedId = latestRow.id;

            // If the user passed an update function, call it with the current instance.
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
            if (latestRow.effective_from > encodedCheckpoint)
              throw new Error(
                `Cannot update ${tableName} record with ID ${encodedId} at checkpoint ${encodedCheckpoint} because there is a newer version of the record at checkpoint ${latestRow.effective_from}. Hint: Did you forget to await the promise returned by a store method?`,
              );

            // If the latest version has the same effective_from timestamp as the update,
            // this update is occurring within the same block/second. Update in place.
            if (latestRow.effective_from === encodedCheckpoint) {
              return await tx
                .updateTable(tableName)
                .set(updateRow)
                .where("id", "=", encodedId)
                .where("effective_from", "=", encodedCheckpoint)
                .returningAll()
                .executeTakeFirstOrThrow();
            }

            // If the latest version has an earlier effective_from than the update,
            // we need to update the latest version AND insert a new version.
            await tx
              .updateTable(tableName)
              .where("id", "=", encodedId)
              .where("effective_to", "=", "latest")
              .set({ effective_to: encodedCheckpoint })
              .execute();
            return tx
              .insertInto(tableName)
              .values({
                ...latestRow,
                ...updateRow,
                effective_from: encodedCheckpoint,
                effective_to: "latest",
              })
              .returningAll()
              .executeTakeFirstOrThrow();
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "upsert", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");
      const createRow = encodeRow({ id, ...create }, table, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .where("effective_to", "=", "latest")
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
        if (latestRow === undefined) {
          return await tx
            .insertInto(tableName)
            .values({
              ...createRow,
              effective_from: encodedCheckpoint,
              effective_to: "latest",
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the user passed an update function, call it with the current instance.
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
        if (latestRow.effective_from > encodedCheckpoint)
          throw new Error(
            `Cannot update ${tableName} record with ID ${id} at checkpoint ${encodedCheckpoint} because there is a newer version of the record at checkpoint ${latestRow.effective_from}. Hint: Did you forget to await the promise returned by a store method?`,
          );

        // If the latest version has the same effective_from as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effective_from === encodedCheckpoint) {
          return await tx
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", encodedId)
            .where("effective_from", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effective_from than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(tableName)
          .where("id", "=", encodedId)
          .where("effective_to", "=", "latest")
          .set({ effective_to: encodedCheckpoint })
          .execute();
        return tx
          .insertInto(tableName)
          .values({
            ...latestRow,
            ...updateRow,
            effective_from: encodedCheckpoint,
            effective_to: "latest",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "delete", tableName }, async () => {
      const encodedId = encodeValue(id, table.id, "sqlite");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version has effective_from equal to current checkpoint,
        // this row was created within the same indexing function, and we can delete it.
        let deletedRow = await tx
          .deleteFrom(tableName)
          .where("id", "=", encodedId)
          .where("effective_from", "=", encodedCheckpoint)
          .where("effective_to", "=", "latest")
          .returning(["id"])
          .executeTakeFirst();

        // If we did not take the shortcut above, update the latest record
        // setting effective_to to the current checkpoint.
        if (!deletedRow) {
          deletedRow = await tx
            .updateTable(tableName)
            .set({ effective_to: encodedCheckpoint })
            .where("id", "=", encodedId)
            .where("effective_to", "=", "latest")
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
