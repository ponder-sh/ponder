import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import {
  getTableConfig,
  type PgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";
import { getColumnCasing } from "./kit/index.js";

/**
 * The names of the tables in a user schema, for metric labels.
 *
 * Here rather than in `internal/metrics.ts` so that knowing what a Drizzle
 * table is stays in the schema layer.
 */
export const getSchemaTableNames = (schema: {
  [name: string]: unknown;
}): string[] => Object.values(schema).filter(isTable).map(getTableName);

export const getPrimaryKeyColumns = (
  table: PgTable,
): { sql: string; js: string }[] => {
  const primaryKeys = getTableConfig(table).primaryKeys;

  const findJsName = (column: PgColumn): string => {
    const name = column.name;
    for (const [js, column] of Object.entries(getTableColumns(table))) {
      if (column.name === name) return js;
    }

    throw "unreachable";
  };

  if (primaryKeys.length > 0) {
    return primaryKeys[0]!.columns.map((column) => ({
      sql: getColumnCasing(column, "snake_case"),
      js: findJsName(column),
    }));
  }

  const pkColumn = Object.values(getTableColumns(table)).find(
    (c) => c.primary,
  )!;

  return [
    {
      sql: getColumnCasing(pkColumn, "snake_case"),
      js: findJsName(pkColumn),
    },
  ];
};
