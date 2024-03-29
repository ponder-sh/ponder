import type { Common } from "@/common/common.js";
import { NonRetryableError, StoreError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import { startClock } from "@/utils/timer.js";
import {
  Kysely,
  PostgresDialect,
  SqliteDialect,
  WithSchemaPlugin,
} from "kysely";
import type { Pool } from "pg";
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
  private common: Common;
  private isKilled = false;

  db: Kysely<any>;
  schema: Schema;
  kind: "sqlite" | "postgres";

  constructor({
    common,
    database,
    schema,
  }: {
    common: Common;
    database:
      | { kind: "sqlite"; database: SqliteDatabase }
      | { kind: "postgres"; pool: Pool };
    schema: Schema;
  }) {
    this.common = common;
    this.schema = schema;
    this.kind = database.kind;

    if (database.kind === "sqlite") {
      this.db = new Kysely({
        dialect: new SqliteDialect({ database: database.database }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_sqlite_query_total.inc({
              database: "indexing",
            });
          }
        },
      });
    } else {
      this.db = new Kysely({
        dialect: new PostgresDialect({ pool: database.pool }),
        log(event) {
          if (event.level === "query") {
            common.metrics.ponder_postgres_query_total.inc({
              pool: "indexing",
            });
          }
        },
        plugins: [new WithSchemaPlugin("ponder")],
      });
    }
  }

  kill = () => {
    this.isKilled = true;
  };

  findUnique = async ({
    tableName,
    id,
  }: {
    tableName: string;
    id: string | number | bigint;
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.findUnique` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);

      const row = await this.db
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

    return this.wrap({ method: `${tableName}.findMany` }, async () => {
      let query = this.db.selectFrom(tableName).selectAll();

      if (where) {
        query = query.where((eb) =>
          buildWhereConditions({ eb, where, table, encoding: this.kind }),
        );
      }

      const orderByConditions = buildOrderByConditions({ orderBy, table });
      for (const [column, direction] of orderByConditions) {
        query = query.orderBy(column, direction);
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
    id,
    data = {},
  }: {
    tableName: string;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.create` }, async () => {
      const createRow = encodeRow({ id, ...data }, table, this.kind);

      try {
        const row = await this.db
          .insertInto(tableName)
          .values(createRow)
          .returningAll()
          .executeTakeFirstOrThrow();
        return decodeRow(row, table, "postgres");
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
    data,
  }: {
    tableName: string;
    data: Row[];
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.createMany` }, async () => {
      const createRows = data.map((d) => encodeRow({ ...d }, table, this.kind));

      const chunkedRows: (typeof createRows)[] = [];
      for (let i = 0, len = createRows.length; i < len; i += MAX_BATCH_SIZE)
        chunkedRows.push(createRows.slice(i, i + MAX_BATCH_SIZE));

      try {
        const rows = await this.db.transaction().execute((tx) => {
          return Promise.all(
            chunkedRows.map((c) =>
              tx.insertInto(tableName).values(c).returningAll().execute(),
            ),
          );
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
    id,
    data = {},
  }: {
    tableName: string;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.update` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);

      // Find the latest version of this instance.
      const latestRow = await this.db
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

      const row = await this.db
        .updateTable(tableName)
        .set(updateRow)
        .where("id", "=", encodedId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = decodeRow(row, table, this.kind);

      return result;
    });
  };

  updateMany = async ({
    tableName,
    where,
    data = {},
  }: {
    tableName: string;
    where: WhereInput<any>;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.updateMany` }, async () => {
      let query = this.db.selectFrom(tableName).selectAll();

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

      const rows = await this.db.transaction().execute((tx) => {
        return Promise.all(
          latestRows.map((latestRow) => {
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
              .updateTable(tableName)
              .set(updateRow)
              .where("id", "=", latestRow.id)
              .returningAll()
              .executeTakeFirstOrThrow();
          }),
        );
      });

      return rows.map((row) => decodeRow(row, table, this.kind));
    });
  };

  upsert = async ({
    tableName,
    id,
    create = {},
    update = {},
  }: {
    tableName: string;
    id: string | number | bigint;
    create?: Omit<Row, "id">;
    update?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.upsert` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);
      const createRow = encodeRow({ id, ...create }, table, this.kind);

      // Find the latest version of this instance.
      const latestRow = await this.db
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", encodedId)
        .executeTakeFirst();

      // If there is no latest version, insert a new version using the create data.
      if (latestRow === undefined) {
        return this.db
          .insertInto(tableName)
          .values(createRow)
          .returningAll()
          .executeTakeFirstOrThrow() as Promise<Row>;
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

      const row = await this.db
        .updateTable(tableName)
        .set(updateRow)
        .where("id", "=", encodedId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return decodeRow(row, table, this.kind);
    });
  };

  delete = async ({
    tableName,
    id,
  }: {
    tableName: string;
    id: string | number | bigint;
  }) => {
    const table = this.schema.tables[tableName];

    return this.wrap({ method: `${tableName}.delete` }, async () => {
      const encodedId = encodeValue(id, table.id, this.kind);

      const deletedRow = await this.db
        .deleteFrom(tableName)
        .where("id", "=", encodedId)
        .returning(["id"])
        .executeTakeFirst();

      return !!deletedRow;
    });
  };

  private wrap = async <T>(
    options: { method: string },
    fn: () => Promise<T>,
  ) => {
    const endClock = startClock();
    const RETRY_COUNT = 3;
    const BASE_DURATION = 25;

    let error: any;
    let hasError = false;

    for (let i = 0; i < RETRY_COUNT + 1; i++) {
      try {
        const result = await fn();
        this.common.metrics.ponder_database_method_duration.observe(
          { service: "indexing", method: options.method },
          endClock(),
        );
        return result;
      } catch (_error) {
        if (this.isKilled || _error instanceof NonRetryableError) {
          throw _error;
        }

        if (!hasError) {
          hasError = true;
          error = _error;
        }

        if (i < RETRY_COUNT) {
          const duration = BASE_DURATION * 2 ** i;
          this.common.logger.warn({
            service: "database",
            msg: `Database error while running ${options.method}, retrying after ${duration} milliseconds. Error: ${error.message}`,
          });
          await new Promise((_resolve) => {
            setTimeout(_resolve, duration);
          });
        }
      }
    }

    this.common.metrics.ponder_database_method_error_total.inc({
      service: "indexing",
      method: options.method,
    });

    throw error;
  };
}
