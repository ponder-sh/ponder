import type { Table as PonderTable } from "@/schema/common.js";
import {
  isMaterialColumn,
  isOptionalColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import type { Table } from "drizzle-orm";
import { drizzle as drizzleSQLite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { pgTable } from "drizzle-orm/pg-core";
import {
  integer as SQLiteInteger,
  text as SQLiteText,
  sqliteTable,
} from "drizzle-orm/sqlite-core";
import type { Pool } from "pg";

export const createDrizzleDb = (
  database:
    | { kind: "postgres"; pool: Pool }
    | { kind: "sqlite"; database: SqliteDatabase },
) => {
  if (database.kind === "postgres") {
    const drizzle = drizzlePg(database.pool);
    drizzle.execute;
    return {
      // @ts-ignore
      select: (...args: any[]) => drizzle.select(...args),
      execute: (query: any) => drizzle.execute(query),
    };
  } else {
    const drizzle = drizzleSQLite(database.database);
    return {
      // @ts-ignore
      select: (...args: any[]) => drizzle.select(...args),
      execute: (query: any) => drizzle.all(query),
    };
  }
};

export const convertToDrizzleTable = (
  tableName: string,
  table: PonderTable,
  kind: "sqlite" | "postgres",
): Table => {
  const columns = Object.entries(table).reduce<{ [columnName: string]: any }>(
    (acc, [columnName, column]) => {
      if (isMaterialColumn(column)) {
        if (isScalarColumn(column) || isReferenceColumn(column)) {
          let drizzleColumn =
            column[" scalar"] === "string"
              ? SQLiteText(columnName)
              : column[" scalar"] === "int"
                ? SQLiteInteger(columnName)
                : undefined;

          // apply column constraints
          if (columnName === "id") {
            drizzleColumn = drizzleColumn!.primaryKey();
          } else if (isOptionalColumn(column) === false) {
            drizzleColumn = drizzleColumn!.notNull();
          }

          acc[columnName] = drizzleColumn;
        }
      }
      return acc;
    },
    {},
  );

  if (kind === "postgres") {
    return pgTable(tableName, columns);
  } else {
    return sqliteTable(tableName, columns);
  }
};
