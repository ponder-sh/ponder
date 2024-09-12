import type { Database } from "@/database/index.js";
import type { Scalar, Schema } from "@/schema/common.js";
import {
  isEnumColumn,
  isJSONColumn,
  isListColumn,
  isMaterialColumn,
  isOptionalColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import { getTables } from "@/schema/utils.js";
import type { SqliteDatabase } from "@/utils/sqlite.js";
import { type Table, TableAliasProxyHandler } from "drizzle-orm";
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
import type { View } from "drizzle-orm/sql";
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
import { PgListBuilder, SQLiteListBuilder } from "./list.js";
import type { BuildAliasTable } from "./select.js";

export const createDrizzleDb = (database: Database) => {
  if (database.dialect === "postgres") {
    const drizzle = drizzlePg(database.driver.readonly as Pool);
    return {
      // @ts-ignore
      select: (...args: any[]) => drizzle.select(...args),
      execute: (query: any) => drizzle.execute(query),
    };
  } else {
    const drizzle = drizzleSQLite(database.driver.readonly as SqliteDatabase);
    return {
      // @ts-ignore
      select: (...args: any[]) => drizzle.select(...args),
      execute: (query: any) => {
        try {
          try {
            return drizzle.all(query);
          } catch (e) {
            const error = e as Error;
            if (
              error.name === "SqliteError" &&
              error.message ===
                "This statement does not return data. Use run() instead"
            ) {
              return drizzle.run(query);
            } else {
              throw error;
            }
          }
        } catch (e) {
          const error = e as Error;
          if (error.cause) throw error.cause;
          throw error;
        }
      },
    };
  }
};

export function alias<tableOrView extends Table | View, alias extends string>(
  table: tableOrView,
  alias: alias,
): BuildAliasTable<tableOrView, alias> {
  return new Proxy(table, new TableAliasProxyHandler(alias, false)) as any;
}

type SQLiteTable = Parameters<typeof sqliteTable>[1];
type PostgresTable = Parameters<typeof pgTable>[1];
type DrizzleTable = { [tableName: string]: any };

export const createDrizzleTables = (schema: Schema, database: Database) => {
  const drizzleTables: { [tableName: string]: DrizzleTable } = {};

  for (const [tableName, { table }] of Object.entries(getTables(schema))) {
    const drizzleColumns: DrizzleTable = {};

    for (const [columnName, column] of Object.entries(table)) {
      if (isMaterialColumn(column)) {
        if (isJSONColumn(column)) {
          drizzleColumns[columnName] = convertJsonColumn(
            columnName,
            database.dialect,
          );
        } else if (isEnumColumn(column)) {
          if (isListColumn(column)) {
            drizzleColumns[columnName] = convertListColumn(
              columnName,
              database.dialect,
              "string",
            );
          } else {
            drizzleColumns[columnName] = convertEnumColumn(
              columnName,
              database.dialect,
            );
          }
        } else if (isScalarColumn(column) || isReferenceColumn(column)) {
          if (isListColumn(column)) {
            drizzleColumns[columnName] = convertListColumn(
              columnName,
              database.dialect,
              column[" scalar"],
            );
          } else {
            switch (column[" scalar"]) {
              case "string":
                drizzleColumns[columnName] = convertStringColumn(
                  columnName,
                  database.dialect,
                );
                break;

              case "int":
                drizzleColumns[columnName] = convertIntColumn(
                  columnName,
                  database.dialect,
                );
                break;

              case "boolean":
                drizzleColumns[columnName] = convertBooleanColumn(
                  columnName,
                  database.dialect,
                );
                break;

              case "float":
                drizzleColumns[columnName] = convertFloatColumn(
                  columnName,
                  database.dialect,
                );
                break;

              case "hex":
                drizzleColumns[columnName] = convertHexColumn(
                  columnName,
                  database.dialect,
                );
                break;

              case "bigint":
                drizzleColumns[columnName] = convertBigintColumn(
                  columnName,
                  database.dialect,
                );
                break;
            }
          }

          // apply column constraints
          if (columnName === "id") {
            drizzleColumns[columnName] =
              drizzleColumns[columnName]!.primaryKey();
          } else if (isOptionalColumn(column) === false) {
            drizzleColumns[columnName] = drizzleColumns[columnName]!.notNull();
          }
        }
      }
    }

    if (database.dialect === "postgres") {
      // Note: this is to avoid an error thrown by drizzle when
      // setting schema to "public".
      if (database.namespace === "public") {
        drizzleTables[tableName] = pgTable(
          tableName,
          drizzleColumns as PostgresTable,
        );
      } else {
        drizzleTables[tableName] = pgSchema(database.namespace).table(
          tableName,
          drizzleColumns as PostgresTable,
        );
      }
    } else {
      drizzleTables[tableName] = sqliteTable(
        tableName,
        drizzleColumns as SQLiteTable,
      );
    }
  }

  return drizzleTables;
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

const convertListColumn = (
  columnName: string,
  kind: "sqlite" | "postgres",
  element: Scalar,
) => {
  return kind === "sqlite"
    ? new SQLiteListBuilder(columnName, element)
    : new PgListBuilder(columnName, element);
};

const convertJsonColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite"
    ? new SQLiteJsonBuilder(columnName)
    : PgJsonb(columnName);
};

const convertEnumColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite" ? SQLiteText(columnName) : PgText(columnName);
};
