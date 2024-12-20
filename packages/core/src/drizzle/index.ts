import { getTableColumns, getTableName, is } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type PgColumn, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { getColumnCasing, sqlToReorgTableName } from "./kit/index.js";

export type Drizzle<TSchema extends Schema = { [name: string]: never }> =
  | NodePgDatabase<TSchema>
  | PgliteDatabase<TSchema>;

export type ReadonlyDrizzle<
  TSchema extends Schema = { [name: string]: never },
> = Omit<
  Drizzle<TSchema>,
  | "insert"
  | "update"
  | "delete"
  | "transaction"
  | "refreshMaterializedView"
  | "_"
>;

export type Schema = { [name: string]: unknown };

export const getTableNames = (schema: Schema) => {
  const tableNames = Object.entries(schema)
    .filter(([, table]) => is(table, PgTable))
    .map(([js, table]) => {
      const sql = getTableName(table as PgTable);

      return {
        sql,
        reorg: sqlToReorgTableName(sql),
        trigger: sqlToReorgTableName(sql),
        triggerFn: `operation_reorg__${sql}()`,
        js,
      } as const;
    });

  return tableNames;
};

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
