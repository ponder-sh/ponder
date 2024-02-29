import type { Common } from "@/Ponder.js";
import type { Schema } from "@/schema/types.js";
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
import { revertTable } from "../utils/revert.js";
import { buildOrderByConditions } from "../utils/sort.js";

const MAX_BATCH_SIZE = 1_000 as const;

const DEFAULT_LIMIT = 50 as const;
const MAX_LIMIT = 1_000 as const;

export class PostgresIndexingStore implements IndexingStore {
  kind = "postgres" as const;
  private common: Common;

  db: Kysely<any>;
  schema: Schema;

  constructor({
    common,
    pool,
    schemaName,
    schema,
  }: {
    common: Common;
    pool: Pool;
    schemaName: string;
    schema: Schema;
  }) {
    this.common = common;
    this.schema = schema;

    this.db = new Kysely({
      dialect: new PostgresDialect({ pool }),
      log(event) {
        if (event.level === "query")
          common.metrics.ponder_postgres_query_count?.inc({ kind: "indexing" });
      },
    }).withPlugin(new WithSchemaPlugin(schemaName));
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
      const formattedId = encodeValue(id, table.id, "postgres");

      let query = this.db
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", formattedId);

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

      const whereConditions = buildWhereConditions({
        where,
        table,
        encoding: "postgres",
      });
      for (const [columnName, comparator, value] of whereConditions) {
        query = query.where(columnName, comparator, value);
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

        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, "postgres"));

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
      const createRow = encodeRow({ id, ...data }, table, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db
        .insertInto(tableName)
        .values({
          ...createRow,
          effective_from: encodedCheckpoint,
          effective_to: "latest",
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "createMany", tableName }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const createRows = data.map((d) => ({
        ...encodeRow({ ...d }, table, "postgres"),
        effective_from: encodedCheckpoint,
        effective_to: "latest",
      }));

      const chunkedRows = [];
      for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
        chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

      const rows = await Promise.all(
        chunkedRows.map((c) =>
          this.db.insertInto(tableName).values(c).returningAll().execute(),
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "update", tableName }, async () => {
      const formattedId = encodeValue(id, table.id, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", formattedId)
          .where("effective_to", "=", "latest")
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
        if (latestRow.effective_from > encodedCheckpoint) {
          throw new Error("Cannot update a record in the past");
        }

        // If the latest version has the same effective_from as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effective_from === encodedCheckpoint) {
          return await tx
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", formattedId)
            .where("effective_from", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effective_from than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(tableName)
          .where("id", "=", formattedId)
          .where("effective_to", "=", "latest")
          .set({ effective_to: encodedCheckpoint })
          .execute();
        const row = await tx
          .insertInto(tableName)
          .values({
            ...latestRow,
            ...updateRow,
            effective_from: encodedCheckpoint,
            effective_to: "latest",
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "updateMany", tableName }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const rows = await this.db.transaction().execute(async (tx) => {
        // Get all IDs that match the filter.
        let query = tx
          .selectFrom(tableName)
          .selectAll()
          .where("effective_to", "=", "latest");

        const whereConditions = buildWhereConditions({
          where,
          table,
          encoding: "postgres",
        });
        for (const [columnName, comparator, value] of whereConditions) {
          query = query.where(columnName, comparator, value);
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
            if (latestRow.effective_from > encodedCheckpoint) {
              throw new Error("Cannot update a record in the past");
            }

            // If the latest version has the same effectiveFrom timestamp as the update,
            // this update is occurring within the same block/second. Update in place.
            if (latestRow.effective_from === encodedCheckpoint) {
              return await tx
                .updateTable(tableName)
                .set(updateRow)
                .where("id", "=", formattedId)
                .where("effective_from", "=", encodedCheckpoint)
                .returningAll()
                .executeTakeFirstOrThrow();
            }

            // If the latest version has an earlier effective_from than the update,
            // we need to update the latest version AND insert a new version.
            await tx
              .updateTable(tableName)
              .where("id", "=", formattedId)
              .where("effective_to", "=", "latest")
              .set({ effective_to: encodedCheckpoint })
              .execute();
            const row = await tx
              .insertInto(tableName)
              .values({
                ...latestRow,
                ...updateRow,
                effective_from: encodedCheckpoint,
                effective_to: "latest",
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "upsert", tableName }, async () => {
      const formattedId = encodeValue(id, table.id, "postgres");
      const createRow = encodeRow({ id, ...create }, table, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", formattedId)
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
          const current = decodeRow(latestRow, table, "postgres");
          const updateObject = update({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, "postgres");
        } else {
          updateRow = encodeRow({ id, ...update }, table, "postgres");
        }

        // If the update would be applied to a record other than the latest
        // record, throw an error.
        if (latestRow.effective_from > encodedCheckpoint) {
          throw new Error("Cannot update a record in the past");
        }

        // If the latest version has the same effective_from as the update,
        // this update is occurring within the same indexing function. Update in place.
        if (latestRow.effective_from === encodedCheckpoint) {
          return await tx
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", formattedId)
            .where("effective_from", "=", encodedCheckpoint)
            .returningAll()
            .executeTakeFirstOrThrow();
        }

        // If the latest version has an earlier effective_from than the update,
        // we need to update the latest version AND insert a new version.
        await tx
          .updateTable(tableName)
          .where("id", "=", formattedId)
          .where("effective_to", "=", "latest")
          .set({ effective_to: encodedCheckpoint })
          .execute();
        const row = await tx
          .insertInto(tableName)
          .values({
            ...latestRow,
            ...updateRow,
            effective_from: encodedCheckpoint,
            effective_to: "latest",
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
    const table = this.schema.tables[tableName];

    return this.wrap({ method: "delete", tableName }, async () => {
      const formattedId = encodeValue(id, table.id, "postgres");
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const isDeleted = await this.db.transaction().execute(async (tx) => {
        // If the latest version has effective_from equal to current checkpoint,
        // this row was created within the same indexing function, and we can delete it.
        let deletedRow = await tx
          .deleteFrom(tableName)
          .where("id", "=", formattedId)
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
            .where("id", "=", formattedId)
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
