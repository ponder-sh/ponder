import type {
  EnumColumn,
  ExtractNonVirtualColumnNames,
  JSONColumn,
  Schema as PonderSchema,
  Table as PonderTable,
  ReferenceColumn,
  ScalarColumn,
} from "@/schema/common.js";
import type { InferColumnType } from "@/schema/infer.js";
import type { BuildColumns, ColumnBuilderBase } from "drizzle-orm";
import type { TableWithColumns } from "./select.js";

/**
 * Performs type transformation between Ponder and Drizzle column representation.
 *
 * @returns TableWithColumns
 */
export type DrizzleTable<
  tableName extends string,
  table extends PonderTable,
  schema extends PonderSchema,
> = TableWithColumns<{
  name: tableName;
  schema: undefined;
  columns: BuildColumns<
    tableName,
    {
      [columnName in ExtractNonVirtualColumnNames<table>]: ColumnBuilderBase<{
        name: columnName & string;
        dataType: "custom";
        columnType: "ponder";
        data: InferColumnType<table[columnName], schema>;
        driverParam: unknown;
        enumValues: undefined;
        notNull: (table[columnName] &
          (
            | ScalarColumn
            | ReferenceColumn
            | EnumColumn
            | JSONColumn
          ))[" optional"] extends true
          ? false
          : true;
        primaryKey: columnName extends "id" ? true : false;
      }>;
    },
    "common"
  >;
  dialect: "common";
}>;
