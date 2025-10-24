import { getTableColumns, getTableName } from "drizzle-orm";
import {
  type PgColumn,
  type PgTable,
  getTableConfig,
} from "drizzle-orm/pg-core";
import { getColumnCasing, sqlToReorgTableName } from "./kit/index.js";

export const getTableNames = (table: PgTable) => {
  const sql = getTableName(table);

  return {
    reorg: sqlToReorgTableName(sql),
    trigger: sqlToReorgTableName(sql),
    triggerFn: `operation_reorg__${sql}()`,
  };
};

export const getLiveQueryTriggerName = (table: PgTable) => {
  return `live_query_trigger_${getTableName(table)}`;
};
export const getLiveQueryProcedureName = (table: PgTable) => {
  return `live_query_procedure_${getTableName(table)}()`;
};
export const getLiveQueryChannelName = (table: PgTable) => {
  return `live_query_channel_${getTableConfig(table).schema ?? "public"}_${getTableName(table)}`;
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
