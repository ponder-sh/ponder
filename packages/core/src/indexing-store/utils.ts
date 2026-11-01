import {
  and,
  type Column,
  eq,
  getTableColumns,
  getTableName,
  type SQL,
  type SQLWrapper,
  type Table,
} from "drizzle-orm";
import { PgArray, type PgTable } from "drizzle-orm/pg-core";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import {
  BigIntSerializationError,
  NotNullConstraintError,
} from "@/internal/errors.js";
import { prettyPrint } from "@/utils/print.js";

const tableColumnCache = new WeakMap<
  Table,
  {
    columns: Record<string, Column>;
    entries: [string, Column][];
    onUpdateEntries: [string, Column][];
  }
>();

const getCachedTableColumns = (table: Table) => {
  let cached = tableColumnCache.get(table);
  if (cached === undefined) {
    const columns = getTableColumns(table);
    const entries = Object.entries(columns);
    const primaryKeys = getPrimaryKeyColumns(table as PgTable).map(
      ({ js }) => js,
    );
    const onUpdateEntries = entries.filter(
      ([columnName, column]) =>
        column.onUpdateFn !== undefined &&
        primaryKeys.includes(columnName) === false,
    );
    cached = { columns, entries, onUpdateEntries };
    tableColumnCache.set(table, cached);
  }
  return cached;
};

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

export const getPrimaryKeyCache = (tables: Table[]) => {
  const cache = new Map<Table, [string, Column][]>();

  for (const table of tables) {
    cache.set(table, []);
    for (const { js } of getPrimaryKeyColumns(table)) {
      // @ts-expect-error
      cache.get(table)!.push([js, table[js]!]);
    }
  }

  return cache;
};

/** The value that the database returns for the non-null `value` of `column`. */
const roundtrip = (column: Column, value: unknown): unknown => {
  if (column instanceof PgArray && Array.isArray(value)) {
    return value.map((v) => roundtrip(column.baseColumn, v));
  }
  if (column.columnType === "PgTimestamp") return value;
  // Note: The drivers parse JSON, and `mapFromDriverValue` doesn't.
  if (column.columnType === "PgJson" || column.columnType === "PgJsonb") {
    return JSON.parse(column.mapToDriverValue(value) as string);
  }
  return column.mapFromDriverValue(column.mapToDriverValue(value));
};

export const normalizeColumn = (
  column: Column,
  value: unknown,
  isUpdate: boolean,
): unknown => {
  if (value === undefined) {
    if (hasEmptyValue(column)) return getEmptyValue(column, isUpdate);
    return null;
  }
  if (value === null) return null;
  if (column.mapToDriverValue === undefined) return value;

  try {
    return roundtrip(column, value);
  } catch (e) {
    if (
      // node error message
      (e as Error)?.message?.includes(
        "Do not know how to serialize a BigInt",
      ) ||
      // bun error message
      (e as Error)?.message?.includes("cannot serialize BigInt")
    ) {
      const error = new BigIntSerializationError((e as Error).message);
      error.meta.push(
        "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
      );
      throw error;
    }

    throw e;
  }
};

export const normalizeRow = (
  table: Table,
  row: { [key: string]: unknown },
  isUpdate: boolean,
) => {
  for (const [columnName, column] of getCachedTableColumns(table).entries) {
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
      error.meta.push(
        `db.insert arguments:\n${prettyPrint(row, { truncate: false })}`,
      );
      throw error;
    }

    row[columnName] = normalizeColumn(column, row[columnName], isUpdate);
  }

  return row;
};

export const normalizeUpdateSet = (
  table: Table,
  row: { [key: string]: unknown },
) => {
  const { columns, onUpdateEntries } = getCachedTableColumns(table);
  // Note: `row` is a plain object, so `for...in` only visits own keys.
  for (const columnName in row) {
    const value = row[columnName];
    const column = columns[columnName];
    if (value === undefined || column === undefined) continue;
    row[columnName] = normalizeColumn(column, value, true);
  }
  for (const [columnName, column] of onUpdateEntries) {
    if (row[columnName] === undefined) {
      row[columnName] = normalizeColumn(column, undefined, true);
    }
  }
  return row;
};

export const getCacheKey = (
  table: Table,
  key: object,
  cache: Map<Table, [string, Column][]>,
): string => {
  const primaryKeys = cache.get(table)!;

  if (primaryKeys.length === 1) {
    const [pk, col] = primaryKeys[0]!;
    // @ts-expect-error
    return String(normalizeColumn(col, key[pk]!, false));
  }

  // Note: Each value is prefixed with its length, so that values containing
  // the separator can't produce the same key as other values.
  let result = "";
  for (let i = 0; i < primaryKeys.length; i++) {
    const [pk, col] = primaryKeys[i]!;
    // @ts-expect-error
    const value = String(normalizeColumn(col, key[pk]!, false));
    result += `${value.length}_${value}`;
  }

  return result;
};

/** Returns an sql where condition for `table` with `key`. */
export const getWhereCondition = (table: Table, key: Object): SQL<unknown> => {
  const conditions: SQLWrapper[] = [];

  for (const { js } of getPrimaryKeyColumns(table)) {
    // @ts-expect-error
    conditions.push(eq(table[js]!, key[js]));
  }

  return and(...conditions)!;
};
