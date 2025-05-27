import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import {
  BigIntSerializationError,
  NotNullConstraintError,
} from "@/internal/errors.js";
import { prettyPrint } from "@/utils/print.js";
import {
  type Column,
  type SQL,
  type SQLWrapper,
  type Table,
  and,
  eq,
  getTableColumns,
  getTableName,
} from "drizzle-orm";
import { PgArray } from "drizzle-orm/pg-core";

/**
 * Returns true if the column has a "default" value that is used when no value is passed.
 * Handles `.default`, `.$defaultFn()`, `.$onUpdateFn()`.
 */
export const hasEmptyValue = (column: Column) => {
  return column.hasDefault;
};

/** Returns the "default" value for `column`. */
export const getEmptyValue = (column: Column, isUpdate: boolean) => {
  if (isUpdate && column.onUpdateFn) {
    return column.onUpdateFn();
  }
  if (column.default !== undefined) return column.default;
  if (column.defaultFn !== undefined) return column.defaultFn();
  if (column.onUpdateFn !== undefined) return column.onUpdateFn();

  // TODO(kyle) is it an invariant that it doesn't get here

  return undefined;
};

export const normalizeColumn = (
  column: Column,
  value: unknown,
  isUpdate: boolean,
  // @ts-ignore
): unknown => {
  if (value === undefined) {
    if (hasEmptyValue(column)) return getEmptyValue(column, isUpdate);
    return null;
  }
  if (value === null) return null;
  if (column.mapToDriverValue === undefined) return value;

  try {
    if (Array.isArray(value) && column instanceof PgArray) {
      return value.map((v) => {
        if (column.baseColumn.columnType === "PgTimestamp") {
          return v;
        }

        return column.baseColumn.mapFromDriverValue(
          column.baseColumn.mapToDriverValue(v),
        );
      });
    }

    if (column.columnType === "PgTimestamp") {
      return value;
    }

    return column.mapFromDriverValue(column.mapToDriverValue(value));
  } catch (e) {
    if (
      (e as Error)?.message?.includes("Do not know how to serialize a BigInt")
    ) {
      const error = new BigIntSerializationError((e as Error).message);
      error.meta.push(
        "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
      );
      throw error;
    }
  }
};

export const normalizeRow = (
  table: Table,
  row: { [key: string]: unknown },
  isUpdate: boolean,
) => {
  for (const [columnName, column] of Object.entries(getTableColumns(table))) {
    // not-null constraint
    if (
      isUpdate === false &&
      (row[columnName] === undefined || row[columnName] === null) &&
      column.notNull &&
      hasEmptyValue(column) === false
    ) {
      const error = new NotNullConstraintError(
        `Column '${getTableName(
          table,
        )}.${columnName}' violates not-null constraint.`,
      );
      error.meta.push(`db.insert arguments:\n${prettyPrint(row)}`);
      throw error;
    }

    row[columnName] = normalizeColumn(column, row[columnName], isUpdate);
  }

  return row;
};

export const getCacheKey = (
  table: Table,
  key: object,
  cache?: Map<Table, [string, Column][]>,
): string => {
  if (cache) {
    const primaryKeys = cache.get(table)!;
    return (
      primaryKeys
        // @ts-ignore
        .map(([pk, col]) => normalizeColumn(col, key[pk]))
        .join("_")
    );
  }

  const primaryKeys = getPrimaryKeyColumns(table);
  return (
    primaryKeys
      // @ts-ignore
      .map((pk) => normalizeColumn(table[pk.js], key[pk.js]))
      .join("_")
  );
};

/** Returns an sql where condition for `table` with `key`. */
export const getWhereCondition = (table: Table, key: Object): SQL<unknown> => {
  const conditions: SQLWrapper[] = [];

  for (const { js } of getPrimaryKeyColumns(table)) {
    // @ts-ignore
    conditions.push(eq(table[js]!, key[js]));
  }

  return and(...conditions)!;
};
