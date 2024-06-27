import type { DatabaseConfig } from "@/config/database.js";
import type { Table as PonderTable } from "@/schema/common.js";
import {
  isEnumColumn,
  isJSONColumn,
  isMaterialColumn,
  isOptionalColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import type { Table } from "drizzle-orm";
import { drizzle as drizzleSQLite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { pgSchema, pgTable } from "drizzle-orm/pg-core";
import {
  doublePrecision as PgDoublePrecision,
  integer as PgInteger,
  jsonb as PgJsonb,
  numeric as PgNumeric,
  text as PgText,
} from "drizzle-orm/pg-core";
import {
  integer as SQLiteInteger,
  real as SQLiteReal,
  text as SQLiteText,
  sqliteTable,
} from "drizzle-orm/sqlite-core";
import type { Pool } from "pg";
import { SQLiteBigintBuilder } from "./bigint.js";
import { PgHexBuilder, SQLiteHexBuilder } from "./hex.js";
import { SQLiteJsonBuilder } from "./json.js";

export const createDrizzleDb = (
  database:
    | { kind: "postgres"; pool: Pool }
    | { kind: "sqlite"; database: SqliteDatabase },
) => {
  if (database.kind === "postgres") {
    const drizzle = drizzlePg(database.pool);
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
  databaseConfig: DatabaseConfig,
): Table => {
  const columns = Object.entries(table).reduce<{ [columnName: string]: any }>(
    (acc, [columnName, column]) => {
      if (isMaterialColumn(column)) {
        if (isJSONColumn(column)) {
          acc[columnName] = convertJsonColumn(columnName, databaseConfig.kind);
        } else if (isEnumColumn(column)) {
          acc[columnName] = convertEnumColumn(columnName, databaseConfig.kind);
        } else if (isScalarColumn(column) || isReferenceColumn(column)) {
          switch (column[" scalar"]) {
            case "string":
              acc[columnName] = convertStringColumn(
                columnName,
                databaseConfig.kind,
              );
              break;

            case "int":
              acc[columnName] = convertIntColumn(
                columnName,
                databaseConfig.kind,
              );
              break;

            case "boolean":
              acc[columnName] = convertBooleanColumn(
                columnName,
                databaseConfig.kind,
              );
              break;

            case "float":
              acc[columnName] = convertFloatColumn(
                columnName,
                databaseConfig.kind,
              );
              break;

            case "hex":
              acc[columnName] = convertHexColumn(
                columnName,
                databaseConfig.kind,
              );
              break;

            case "bigint":
              acc[columnName] = convertBigintColumn(
                columnName,
                databaseConfig.kind,
              );
              break;
          }

          // apply column constraints
          if (columnName === "id") {
            acc[columnName] = acc[columnName]!.primaryKey();
          } else if (isOptionalColumn(column) === false) {
            acc[columnName] = acc[columnName]!.notNull();
          }
        }
      }
      return acc;
    },
    {},
  );

  if (databaseConfig.kind === "postgres") {
    if (databaseConfig.schema === "public") return pgTable(tableName, columns);
    return pgSchema(databaseConfig.schema).table(tableName, columns);
  } else {
    return sqliteTable(tableName, columns);
  }
};

const convertStringColumn = (
  columnName: string,
  kind: "sqlite" | "postgres",
) => {
  return kind === "sqlite" ? SQLiteText(columnName) : PgText(columnName);
};

const convertIntColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite" ? SQLiteInteger(columnName) : PgInteger(columnName);
};

const convertFloatColumn = (
  columnName: string,
  kind: "sqlite" | "postgres",
) => {
  return kind === "sqlite"
    ? SQLiteReal(columnName)
    : PgDoublePrecision(columnName);
};

const convertBooleanColumn = (
  columnName: string,
  kind: "sqlite" | "postgres",
) => {
  return kind === "sqlite" ? SQLiteInteger(columnName) : PgInteger(columnName);
};

const convertHexColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite"
    ? new SQLiteHexBuilder(columnName)
    : new PgHexBuilder(columnName);
};

const convertBigintColumn = (
  columnName: string,
  kind: "sqlite" | "postgres",
) => {
  return kind === "sqlite"
    ? new SQLiteBigintBuilder(columnName)
    : PgNumeric(columnName, { precision: 78 });
};

// TODO(kyle) list

const convertJsonColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite"
    ? new SQLiteJsonBuilder(columnName)
    : PgJsonb(columnName);
};

const convertEnumColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite" ? SQLiteText(columnName) : PgText(columnName);
};
