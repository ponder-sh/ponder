import type { Prettify } from "@/types/utils.js";
import type { Hex } from "viem";
import type {
  Column,
  Constraints,
  Enum,
  EnumColumn,
  ExtractOptionalColumnNames,
  ExtractRequiredColumnNames,
  ExtractTableNames,
  ReferenceColumn,
  Scalar,
  ScalarColumn,
  Schema,
  Table,
} from "./common.js";

export type InferScalarType<scalar extends Scalar> = scalar extends "string"
  ? string
  : scalar extends "int"
    ? number
    : scalar extends "float"
      ? number
      : scalar extends "boolean"
        ? boolean
        : scalar extends "hex"
          ? Hex
          : scalar extends "bigint"
            ? bigint
            : never;

export type InferColumnType<
  column extends Column | unknown,
  schema extends Schema | unknown,
> = column extends ScalarColumn
  ? column[" list"] extends true
    ? InferScalarType<column[" scalar"]>[]
    : InferScalarType<column[" scalar"]>
  : column extends ReferenceColumn
    ? InferScalarType<column[" scalar"]>
    : column extends EnumColumn
      ? (schema[column[" enum"] & keyof schema] & Enum)[number]
      : never;

export type InferTableType<table, schema> = table extends readonly [
  Table,
  Constraints,
]
  ? Prettify<
      {
        [columnName in ExtractRequiredColumnNames<table>]: InferColumnType<
          table[0][columnName],
          schema
        >;
      } & {
        [columnName in ExtractOptionalColumnNames<table>]?: InferColumnType<
          table[0][columnName],
          schema
        >;
      }
    >
  : never;

export type InferSchemaType<schema extends Schema | unknown> = {
  [tableName in ExtractTableNames<schema>]: InferTableType<
    schema[tableName],
    schema
  >;
};
