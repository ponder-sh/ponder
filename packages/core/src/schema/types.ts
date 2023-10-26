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
  TType extends Scalar | `enum:${string}` = Scalar | `enum:${string}`,
  TReferences extends `${string}.id` | never = `${string}.id` | never,
  TOptional extends boolean = boolean,
  TList extends boolean = boolean
> = {
  type: TType;
  references: TReferences;
  optional: TOptional;
  list: TList;
};

export type Virtual<
  TTableName extends string = string,
  TColumnName extends string = string
> = {
  referenceTable: TTableName;
  referenceColumn: TColumnName;
};

export type Table<
  TColumns extends Record<string, Column | Virtual> = Record<
    string,
    Column | Virtual
  >
> = {
  id: Column<ID, never, false, false>;
} & TColumns;

export type Schema = {
  tables: Record<string, Table>;
  enums: Record<string, ITEnum["values"]>;
};

/**
 * Intermediate Type
 *
 * Type returned from enumerable()
 */
export type ITEnum<TValues extends string[] = string[]> = {
  isEnum: true;
  /** @internal */
  table: Record<string, Column>;
  values: TValues;
};

/**
 * Intermediate Type
 *
 * Type returned from table()
 */
export type ITTable<TTable extends Table = Table> = {
  /** @internal */
  isEnum: false;
  /** @internal */
  table: TTable;
};

export type FilterEnums<TSchema extends Record<string, ITTable | ITEnum>> =
  Pick<
    TSchema,
    {
      [key in keyof TSchema]: TSchema[key]["isEnum"] extends true ? key : never;
    }[keyof TSchema]
  >;

export type FilterNonEnums<TSchema extends Record<string, ITTable | ITEnum>> =
  Pick<
    TSchema,
    {
      [key in keyof TSchema]: TSchema[key]["isEnum"] extends false
        ? key
        : never;
    }[keyof TSchema]
  >;

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
