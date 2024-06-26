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
import { pgTable } from "drizzle-orm/pg-core";
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

// TODO: handle schemas

export const convertToDrizzleTable = (
  tableName: string,
  table: PonderTable,
  kind: "sqlite" | "postgres",
): Table => {
  const columns = Object.entries(table).reduce<{ [columnName: string]: any }>(
    (acc, [columnName, column]) => {
      if (isMaterialColumn(column)) {
        if (isJSONColumn(column)) {
          acc[columnName] = convertJsonColumn(columnName, kind);
        } else if (isEnumColumn(column)) {
          acc[columnName] = convertEnumColumn(columnName, kind);
        } else if (isScalarColumn(column) || isReferenceColumn(column)) {
          switch (column[" scalar"]) {
            case "string":
              acc[columnName] = convertStringColumn(columnName, kind);
              break;

            case "int":
              acc[columnName] = convertIntColumn(columnName, kind);
              break;

            case "boolean":
              acc[columnName] = convertBooleanColumn(columnName, kind);
              break;

            case "float":
              acc[columnName] = convertFloatColumn(columnName, kind);
              break;

            case "hex":
              acc[columnName] = convertHexColumn(columnName, kind);
              break;

            case "bigint":
              acc[columnName] = convertBigintColumn(columnName, kind);
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

  if (kind === "postgres") {
    return pgTable(tableName, columns);
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
