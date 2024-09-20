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
} from "drizzle-orm/sqlite-core";
import type { Pool } from "pg";
import { PgHexBuilder } from "./hex.js";
import { PgListBuilder } from "./list.js";

export const createDrizzleDb = (database: Database) => {
  return drizzlePg(database.driver.readonly as Pool);
};

type PostgresTable = Parameters<typeof pgTable>[1];
type DrizzleTable = { [tableName: string]: any };

export const createDrizzleTables = ({
  schema,
  database,
}: {
  schema: Schema;
  database: Database;
}) => {
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
  }

  return drizzleTables;
};

export const ponderHex = (columnName: string) => new PgHexBuilder(columnName);
export const ponderBigint = (columnName: string) =>
  PgNumeric(columnName, { precision: 78 });

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

const convertHexColumn = (columnName: string, _kind: "sqlite" | "postgres") => {
  return new PgHexBuilder(columnName);
};

const convertBigintColumn = (
  columnName: string,
  _kind: "sqlite" | "postgres",
) => {
  return PgNumeric(columnName, { precision: 78 });
};

const convertListColumn = (
  columnName: string,
  _kind: "sqlite" | "postgres",
  element: Scalar,
) => {
  return new PgListBuilder(columnName, element);
};

const convertJsonColumn = (
  columnName: string,
  _kind: "sqlite" | "postgres",
) => {
  return PgJsonb(columnName);
};

const convertEnumColumn = (columnName: string, kind: "sqlite" | "postgres") => {
  return kind === "sqlite" ? SQLiteText(columnName) : PgText(columnName);
};
