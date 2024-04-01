import { StoreError } from "@/common/errors.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema } from "@/schema/types.js";
import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import { sql } from "kysely";
import type { IndexingStore, OrderByInput, Row, WhereInput } from "./store.js";
import {
  buildCursorConditions,
  decodeCursor,
  encodeCursor,
} from "./utils/cursor.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { buildWhereConditions } from "./utils/filter.js";
import {
  buildOrderByConditions,
  reverseOrderByConditions,
} from "./utils/sort.js";

const MAX_BATCH_SIZE = 1_000 as const;
const DEFAULT_LIMIT = 50 as const;
const MAX_LIMIT = 1_000 as const;

export class RealtimeIndexingStore implements IndexingStore {
  kind: "sqlite" | "postgres";
  private namespaceInfo: NamespaceInfo;

  db: HeadlessKysely<any>;
  schema: Schema;

  constructor({
    kind,
    schema,
    namespaceInfo,
    db,
  }: {
    kind: "sqlite" | "postgres";
    schema: Schema;
    namespaceInfo: NamespaceInfo;
    db: HeadlessKysely<any>;
  }) {
    this.kind = kind;
    this.schema = schema;
    this.namespaceInfo = namespaceInfo;
    this.db = db;
  }

  async revert({ checkpoint }: { checkpoint: Checkpoint }) {
    await this.db.wrap({ method: "revert" }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      await Promise.all(
        Object.entries(this.namespaceInfo.internalTableIds).map(
          async ([tableName, tableId]) => {
            await this.db.transaction().execute(async (tx) => {
              const rows = await tx
                .withSchema(this.namespaceInfo.internalNamespace)
                .deleteFrom(tableId)
                .returningAll()
                .where("checkpoint", ">", encodedCheckpoint)
                .execute();

              const reversed = rows.sort(
                (a, b) => b.operation_id - a.operation_id,
              );

              // undo operation
              for (const log of reversed) {
                if (log.operation === 0) {
                  // create
                  await tx
                    .withSchema(this.namespaceInfo.userNamespace)
                    .deleteFrom(tableName)
                    .where("id", "=", log.id)
                    .execute();
                } else if (log.operation === 1) {
                  // update
                  log.operation_id = undefined;
                  log.checkpoint = undefined;
                  log.operation = undefined;

                  await tx
                    .withSchema(this.namespaceInfo.userNamespace)
                    .updateTable(tableName)
                    .set(log)
                    .where("id", "=", log.id)
                    .execute();
                } else {
                  // delete
                  log.operation_id = undefined;
                  log.checkpoint = undefined;
                  log.operation = undefined;

                  await tx
                    .withSchema(this.namespaceInfo.userNamespace)
                    .insertInto(tableName)
                    .values(log)
                    .execute();
                }
              }
            });
          },
        ),
      );
    });
  }

  findUnique = async ({
    tableName,
    id,
  }: {
    tableName: string;
    id: string | number | bigint;
  }) => {
    const table = this.schema.tables[tableName];

    return this.db.wrap({ method: `${tableName}.findUnique` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);

      const row = await this.db
        .withSchema(this.namespaceInfo.userNamespace)
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", encodedId)
        .executeTakeFirst();

      if (row === undefined) return null;

      return decodeRow(row, table, this.kind);
    });
  };

  findMany = async ({
    tableName,
    where,
    orderBy,
    before = null,
    after = null,
    limit = DEFAULT_LIMIT,
  }: {
    tableName: string;
    where?: WhereInput<any>;
    orderBy?: OrderByInput<any>;
    before?: string | null;
    after?: string | null;
    limit?: number;
  }) => {
    const table = this.schema.tables[tableName];

    return this.db.wrap({ method: `${tableName}.findMany` }, async () => {
      let query = this.db
        .withSchema(this.namespaceInfo.userNamespace)
        .selectFrom(tableName)
        .selectAll();

      if (where) {
        query = query.where((eb) =>
          buildWhereConditions({ eb, where, table, encoding: this.kind }),
        );
      }

      const orderByConditions = buildOrderByConditions({ orderBy, table });
      for (const [column, direction] of orderByConditions) {
        query = query.orderBy(
          column,
          this.kind === "sqlite"
            ? direction
            : direction === "asc"
              ? sql`asc nulls first`
              : sql`desc nulls last`,
        );
      }
      const orderDirection = orderByConditions[0][1];

      if (limit > MAX_LIMIT) {
        throw new StoreError(
          `Invalid limit. Got ${limit}, expected <=${MAX_LIMIT}.`,
        );
      }

      if (after !== null && before !== null) {
        throw new StoreError("Cannot specify both before and after cursors.");
      }

      let startCursor = null;
      let endCursor = null;
      let hasPreviousPage = false;
      let hasNextPage = false;

      // Neither cursors are specified, apply the order conditions and execute.
      if (after === null && before === null) {
        query = query.limit(limit + 1);
        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, this.kind));

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
          encodeValue(value, table[columnName], this.kind),
        ]) satisfies [string, any][];
        query = query
          .where((eb) =>
            buildCursorConditions(cursorValues, "after", orderDirection, eb),
          )
          .limit(limit + 2);

        const rows = await query.execute();
        const records = rows.map((row) => decodeRow(row, table, this.kind));

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
          encodeValue(value, table[columnName], this.kind),
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
          .map((row) => decodeRow(row, table, this.kind))
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

    return this.db.wrap({ method: `${tableName}.create` }, async () => {
      const createRow = encodeRow({ id, ...data }, table, this.kind);
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      try {
        return await this.db.transaction().execute(async (tx) => {
          const [row] = await Promise.all([
            tx
              .withSchema(this.namespaceInfo.userNamespace)
              .insertInto(tableName)
              .values(createRow)
              .returningAll()
              .executeTakeFirstOrThrow(),
            tx
              .withSchema(this.namespaceInfo.internalNamespace)
              .insertInto(this.namespaceInfo.internalTableIds[tableName])
              .values({
                operation: 0,
                id: createRow.id,
                checkpoint: encodedCheckpoint,
              })
              .execute(),
          ]);
          return decodeRow(row, table, this.kind);
        });
      } catch (err) {
        const error = err as Error;
        throw error.message.includes("UNIQUE constraint failed")
          ? new StoreError(
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

    return this.db.wrap({ method: `${tableName}.createMany` }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);
      const createRows = data.map((d) => encodeRow({ ...d }, table, this.kind));

      const chunkedRows: (typeof createRows)[] = [];
      for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
        chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

      try {
        const rows = await this.db.transaction().execute(async (tx) => {
          const rowsAndResults = await Promise.all([
            ...chunkedRows.map((chunk) =>
              tx
                .withSchema(this.namespaceInfo.userNamespace)
                .insertInto(tableName)
                .values(chunk)
                .returningAll()
                .execute(),
            ),
            ...chunkedRows.map((chunk) =>
              tx
                .withSchema(this.namespaceInfo.internalNamespace)
                .insertInto(this.namespaceInfo.internalTableIds[tableName])
                .values(
                  chunk.map((row) => ({
                    operation: 0,
                    id: row.id,
                    checkpoint: encodedCheckpoint,
                  })),
                )
                .execute(),
            ),
          ]);

          rowsAndResults.splice(chunkedRows.length, chunkedRows.length);

          return rowsAndResults as Row[][];
        });

        return rows.flat().map((row) => decodeRow(row, table, this.kind));
      } catch (err) {
        const error = err as Error;
        throw error.message.includes("UNIQUE constraint failed")
          ? new StoreError(
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

    return this.db.wrap({ method: `${tableName}.update` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const row = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .withSchema(this.namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();
        if (!latestRow)
          throw new StoreError(
            `Cannot update ${tableName} record with ID ${id} because no existing record was found with that ID. Consider using ${tableName}.upsert(), or create the record before updating it. Hint: Did you forget to await the promise returned by a store method?`,
          );

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof data === "function") {
          const current = decodeRow(latestRow, table, this.kind);
          const updateObject = data({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, this.kind);
        } else {
          updateRow = encodeRow({ id, ...data }, table, this.kind);
        }

        const [updateResult] = await Promise.all([
          tx
            .withSchema(this.namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", encodedId)
            .returningAll()
            .executeTakeFirstOrThrow(),
          tx
            .withSchema(this.namespaceInfo.internalNamespace)
            .insertInto(this.namespaceInfo.internalTableIds[tableName])
            .values({
              operation: 1,
              checkpoint: encodedCheckpoint,
              ...latestRow,
            })
            .execute(),
        ]);
        return updateResult;
      });

      const result = decodeRow(row, table, this.kind);

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

    return this.db.wrap({ method: `${tableName}.updateMany` }, async () => {
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const rows = await this.db.transaction().execute(async (tx) => {
        // TODO(kyle) can remove this from the tx

        // Get all IDs that match the filter.
        let query = tx
          .withSchema(this.namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll();

        if (where) {
          query = query.where((eb) =>
            buildWhereConditions({
              eb,
              where,
              table,
              encoding: this.kind,
            }),
          );
        }

        const latestRows = await query.execute();

        const rowsAndResults = await Promise.all([
          ...latestRows.map((latestRow) => {
            // If the user passed an update function, call it with the current instance.
            let updateRow: ReturnType<typeof encodeRow>;
            if (typeof data === "function") {
              const current = decodeRow(latestRow, table, this.kind);
              const updateObject = data({ current });
              updateRow = encodeRow(updateObject, table, this.kind);
            } else {
              updateRow = encodeRow(data, table, this.kind);
            }

            return tx
              .withSchema(this.namespaceInfo.userNamespace)
              .updateTable(tableName)
              .set(updateRow)
              .where("id", "=", latestRow.id)
              .returningAll()
              .executeTakeFirstOrThrow();
          }),
          ...latestRows.map((latestRow) =>
            tx
              .withSchema(this.namespaceInfo.internalNamespace)
              .insertInto(this.namespaceInfo.internalTableIds[tableName])
              .values({
                operation: 1,
                checkpoint: encodedCheckpoint,
                ...latestRow,
              })
              .execute(),
          ),
        ]);

        rowsAndResults.splice(latestRows.length, latestRows.length);

        return rowsAndResults as Row[];
      });

      return rows.map((row) => decodeRow(row, table, this.kind));
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

    return this.db.wrap({ method: `${tableName}.upsert` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);
      const createRow = encodeRow({ id, ...create }, table, this.kind);
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const [row] = await this.db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .withSchema(this.namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
        if (latestRow === undefined) {
          return Promise.all([
            tx
              .withSchema(this.namespaceInfo.userNamespace)
              .insertInto(tableName)
              .values(createRow)
              .returningAll()
              .executeTakeFirstOrThrow(),
            tx
              .withSchema(this.namespaceInfo.internalNamespace)
              .insertInto(this.namespaceInfo.internalTableIds[tableName])
              .values({
                operation: 0,
                id: createRow.id,
                checkpoint: encodedCheckpoint,
              })
              .execute(),
          ]);
        }

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof update === "function") {
          const current = decodeRow(latestRow, table, this.kind);
          const updateObject = update({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, this.kind);
        } else {
          updateRow = encodeRow({ id, ...update }, table, this.kind);
        }

        return Promise.all([
          tx
            .withSchema(this.namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", encodedId)
            .returningAll()
            .executeTakeFirstOrThrow(),
          tx
            .withSchema(this.namespaceInfo.internalNamespace)
            .insertInto(this.namespaceInfo.internalTableIds[tableName])
            .values({
              operation: 1,
              checkpoint: encodedCheckpoint,
              ...latestRow,
            })
            .execute(),
        ]);
      });

      return decodeRow(row, table, this.kind);
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

    return this.db.wrap({ method: `${tableName}.delete` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);
      const encodedCheckpoint = encodeCheckpoint(checkpoint);

      const isDeleted = await this.db.transaction().execute(async (tx) => {
        const row = await tx
          .withSchema(this.namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        const [deletedRow] = await Promise.all([
          tx
            .withSchema(this.namespaceInfo.userNamespace)
            .deleteFrom(tableName)
            .where("id", "=", encodedId)
            .returning(["id"])
            .executeTakeFirst(),
          row !== undefined
            ? tx
                .withSchema(this.namespaceInfo.internalNamespace)
                .insertInto(this.namespaceInfo.internalTableIds[tableName])
                .values({
                  operation: 2,
                  checkpoint: encodedCheckpoint,
                  ...row,
                })
                .execute()
            : Promise.resolve(),
        ]);

        return !!deletedRow;
      });

      return isDeleted;
    });
  };
}
