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
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PgHexBuilder } from "./hex.js";
import { PgListBuilder } from "./list.js";

export const createDrizzleDb = (database: Database) => {
  const drizzle =
    "instance" in database.driver
      ? drizzlePglite(database.driver.instance)
      : drizzlePg(database.driver.readonly);

  return {
    // @ts-ignore
    select: (...args: any[]) => drizzle.select(...args),
    execute: (query: any) => drizzle.execute(query),
  };
};

type PostgresTable = Parameters<typeof pgTable>[1];
type DrizzleTable = { [tableName: string]: any };

export const createDrizzleTables = (schema: Schema, database: Database) => {
  const drizzleTables: { [tableName: string]: DrizzleTable } = {};

  for (const [tableName, { table }] of Object.entries(getTables(schema))) {
    const drizzleColumns: DrizzleTable = {};

    for (const [columnName, column] of Object.entries(table)) {
      if (isMaterialColumn(column)) {
        if (isJSONColumn(column)) {
          drizzleColumns[columnName] = convertJsonColumn(columnName);
        } else if (isEnumColumn(column)) {
          if (isListColumn(column)) {
            drizzleColumns[columnName] = convertListColumn(
              columnName,
              "string",
            );
          } else {
            drizzleColumns[columnName] = convertEnumColumn(columnName);
          }
        } else if (isScalarColumn(column) || isReferenceColumn(column)) {
          if (isListColumn(column)) {
            drizzleColumns[columnName] = convertListColumn(
              columnName,
              column[" scalar"],
            );
          } else {
            switch (column[" scalar"]) {
              case "string":
                drizzleColumns[columnName] = convertStringColumn(columnName);
                break;

              case "int":
                drizzleColumns[columnName] = convertIntColumn(columnName);
                break;

              case "boolean":
                drizzleColumns[columnName] = convertBooleanColumn(columnName);
                break;

              case "float":
                drizzleColumns[columnName] = convertFloatColumn(columnName);
                break;

              case "hex":
                drizzleColumns[columnName] = convertHexColumn(columnName);
                break;

              case "bigint":
                drizzleColumns[columnName] = convertBigintColumn(columnName);
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

const convertStringColumn = (columnName: string) => {
  return PgText(columnName);
};

const convertIntColumn = (columnName: string) => {
  return PgInteger(columnName);
};

const convertFloatColumn = (columnName: string) => {
  return PgDoublePrecision(columnName);
};

const convertBooleanColumn = (columnName: string) => {
  return PgInteger(columnName);
};

const convertHexColumn = (columnName: string) => {
  return new PgHexBuilder(columnName);
};

const convertBigintColumn = (columnName: string) => {
  return PgNumeric(columnName, { precision: 78 });
};

const convertListColumn = (columnName: string, element: Scalar) => {
  return new PgListBuilder(columnName, element);
};

const convertJsonColumn = (columnName: string) => {
  return PgJsonb(columnName);
};

const convertEnumColumn = (columnName: string) => {
  return PgText(columnName);
};
