import type { Common } from "@/common/common.js";
import { StoreError } from "@/common/errors.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { MaterialColumn, Schema, Table } from "@/schema/common.js";
import type { UserId } from "@/types/schema.js";
import { sql } from "kysely";
import type { OrderByInput, ReadonlyStore, WhereInput } from "./store.js";
import {
  buildCursorConditions,
  decodeCursor,
  encodeCursor,
} from "./utils/cursor.js";
import { decodeRecord, encodeValue } from "./utils/encoding.js";
import { buildWhereConditions } from "./utils/filter.js";
import {
  buildOrderByConditions,
  reverseOrderByConditions,
} from "./utils/sort.js";

const DEFAULT_LIMIT = 50 as const;

export const getReadonlyStore = ({
  encoding,
  schema,
  namespaceInfo,
  db,
  common,
}: {
  encoding: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: Pick<NamespaceInfo, "userNamespace">;
  db: HeadlessKysely<any>;
  common: Common;
}): ReadonlyStore => ({
  findUnique: async ({
    tableName,
    id,
  }: {
    tableName: string;
    id: UserId;
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.findUnique` }, async () => {
      const encodedId = encodeValue({
        value: id,
        column: table.id,
        encoding,
      });

      const record = await db
        .withSchema(namespaceInfo.userNamespace)
        .selectFrom(tableName)
        .selectAll()
        .where("id", "=", encodedId)
        .executeTakeFirst();

      if (record === undefined) return null;

      return decodeRecord({ record, table, encoding });
    });
  },
  findMany: async ({
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
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.findMany` }, async () => {
      let query = db
        .withSchema(namespaceInfo.userNamespace)
        .selectFrom(tableName)
        .selectAll();

      if (where) {
        query = query.where((eb) =>
          buildWhereConditions({ eb, where, table, encoding }),
        );
      }

      const orderByConditions = buildOrderByConditions({ orderBy, table });
      for (const [column, direction] of orderByConditions) {
        query = query.orderBy(
          column,
          encoding === "sqlite"
            ? direction
            : direction === "asc"
              ? sql`asc nulls first`
              : sql`desc nulls last`,
        );
      }
      const orderDirection = orderByConditions[0]![1];

      if (limit > common.options.databaseMaxRowLimit) {
        throw new StoreError(
          `Invalid limit. Got ${limit}, expected <=${common.options.databaseMaxRowLimit}.`,
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
        const records = await query
          .execute()
          .then((records) =>
            records.map((record) => decodeRecord({ record, table, encoding })),
          );

        if (records.length === limit + 1) {
          records.pop();
          hasNextPage = true;
        }

        startCursor =
          records.length > 0
            ? encodeCursor(records[0]!, orderByConditions)
            : null;
        endCursor =
          records.length > 0
            ? encodeCursor(records[records.length - 1]!, orderByConditions)
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
          encodeValue({
            value,
            column: table[columnName] as MaterialColumn,
            encoding,
          }),
        ]) satisfies [string, any][];
        query = query
          .where((eb) =>
            buildCursorConditions(cursorValues, "after", orderDirection, eb),
          )
          .limit(limit + 2);

        const records = await query
          .execute()
          .then((records) =>
            records.map((record) => decodeRecord({ record, table, encoding })),
          );

        if (records.length === 0) {
          return {
            items: records,
            pageInfo: {
              hasNextPage,
              hasPreviousPage,
              startCursor,
              endCursor,
            },
          };
        }

        // If the cursor of the first returned record equals the `after` cursor,
        // `hasPreviousPage` is true. Remove that record.
        if (encodeCursor(records[0]!, orderByConditions) === after) {
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
            ? encodeCursor(records[0]!, orderByConditions)
            : null;
        endCursor =
          records.length > 0
            ? encodeCursor(records[records.length - 1]!, orderByConditions)
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
          encodeValue({
            value,
            column: table[columnName] as MaterialColumn,
            encoding,
          }),
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

        const records = await query.execute().then((records) =>
          records
            .map((record) => decodeRecord({ record, table, encoding }))
            // Reverse the records again, back to the original order.
            .reverse(),
        );

        if (records.length === 0) {
          return {
            items: records,
            pageInfo: {
              hasNextPage,
              hasPreviousPage,
              startCursor,
              endCursor,
            },
          };
        }

        // If the cursor of the last returned record equals the `before` cursor,
        // `hasNextPage` is true. Remove that record.
        if (
          encodeCursor(records[records.length - 1]!, orderByConditions) ===
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
            ? encodeCursor(records[0]!, orderByConditions)
            : null;
        endCursor =
          records.length > 0
            ? encodeCursor(records[records.length - 1]!, orderByConditions)
            : null;

        return {
          items: records,
          pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
        };
      }
    });
  },
});
