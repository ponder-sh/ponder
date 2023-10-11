import { Hex } from "viem";

import { Prettify } from "@/types/utils";

export type Scalar =
  | "string"
  | "int"
  | "float"
  | "boolean"
  | "bytes"
  | "bigint";
export type ID = "string" | "int" | "bytes" | "bigint";

/**
 * SQL Schema types
 */
export type Column<
  TType extends Scalar | `enum:${string}` | unknown = unknown,
  TReferences extends `${string}.id` | never | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown
> = {
  type: TType;
  references: TReferences;
  optional: TOptional;
  list: TList;
};

export type Table<
  TColumns extends Record<string, Column> = Record<string, Column>
> = {
  id: Column<ID, never, false, false>;
} & TColumns;

export type Schema = {
  tables: Record<
    string,
    { id: Column<ID, never, false, false> } & Record<
      string,
      Column<Scalar | `enum:${string}`, unknown, boolean, boolean>
    >
  >;
  enums: Record<string, Enum["values"]>;
};

export type Enum<TValues extends string[] = string[]> = {
  isEnum: true;
  table: Record<string, Column>;
  values: TValues;
};

/**
 * Intermediate Type
 *
 * Type returned from createColumn() or .addColumn()
 *
 * TODO:Kyle Is there something to name table so that it doesn't show up in intellisense
 */
export type IT<
  TColumns extends Record<string, Column> = Record<string, Column>
> = {
  isEnum: false;
  table: Table<TColumns>;
  addColumn: <
    TName extends string,
    TType extends Scalar | `enum:${string}`,
    TReferences extends `${string}.id` | never = never,
    TOptional extends boolean = false,
    TList extends boolean = false
  >(
    name: TName,
    type: TType,
    modifiers?: { references?: TReferences; optional?: TOptional; list?: TList }
  ) => IT<
    TColumns & Record<TName, Column<TType, TReferences, TOptional, TList>>
  >;
};

/**
 * Recover raw typescript types from the intermediate representation
 */
export type RecoverScalarType<TScalar extends Scalar> = TScalar extends "string"
  ? string
  : TScalar extends "int"
  ? number
  : TScalar extends "float"
  ? number
  : TScalar extends "boolean"
  ? boolean
  : TScalar extends "bytes"
  ? Hex
  : TScalar extends "bigint"
  ? bigint
  : never;

export type RecoverColumnType<TColumn extends Column> = TColumn extends {
  type: infer _type extends Scalar;
}
  ? TColumn["list"] extends false
    ? RecoverScalarType<_type>
    : RecoverScalarType<_type>[]
  : never;

export type RecoverOptionalColumns<TColumns extends Record<string, Column>> =
  Pick<
    TColumns,
    {
      [key in keyof TColumns]: TColumns[key]["optional"] extends true
        ? key
        : never;
    }[keyof TColumns]
  >;

export type RecoverRequiredColumns<TColumns extends Record<string, Column>> =
  Pick<
    TColumns,
    {
      [key in keyof TColumns]: TColumns[key]["optional"] extends false
        ? key
        : never;
    }[keyof TColumns]
  >;

export type RecoverTableType<TTable extends Table> =
  TTable extends infer _columns extends {
    id: Column<ID, never, false, false>;
  } & Record<string, Column>
    ? Prettify<
        Record<"id", RecoverScalarType<_columns["id"]["type"]>> & {
          [key in keyof RecoverRequiredColumns<_columns>]: RecoverColumnType<
            _columns[key]
          >;
        } & {
          [key in keyof RecoverOptionalColumns<_columns>]?: RecoverColumnType<
            _columns[key]
          >;
        }
      >
    : never;
