import { getTableColumns, getTableName, is } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type PgColumn, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { getColumnCasing } from "./kit/index.js";

export const onchain = Symbol.for("ponder:onchain");

export type Drizzle<TSchema extends Schema = { [name: string]: never }> =
  | NodePgDatabase<TSchema>
  | PgliteDatabase<TSchema>;

export type Schema = { [name: string]: unknown };

export const userToSqlTableName = (tableName: string, instanceId: string) =>
  `${instanceId}__${tableName}`;

export const sqlToUserTableName = (tableName: string) => tableName.slice(6);

export const userToReorgTableName = (tableName: string, instanceId: string) =>
  `${instanceId}_reorg__${tableName}`;

export const getTableNames = (schema: Schema, instanceId: string) => {
  const tableNames = Object.entries(schema)
    .filter(([, table]) => is(table, PgTable))
    .map(([js, table]) => {
      const tableName = getTableName(table as PgTable);
      const user = sqlToUserTableName(tableName);

      return {
        user,
        sql: userToSqlTableName(user, instanceId),
        reorg: userToReorgTableName(user, instanceId),
        trigger: userToReorgTableName(user, instanceId),
        triggerFn: `operation_${instanceId}_reorg__${user}()`,
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
