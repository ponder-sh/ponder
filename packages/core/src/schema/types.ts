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
  TType extends Scalar | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown
> = {
  type: TType;
  optional: TOptional;
  list: TList;
};

export type Table<
  TName extends string | unknown = unknown,
  TColumns extends
    | ({ id: Column<ID, false, false> } & Record<string, Column>)
    | unknown = unknown
> = {
  name: TName;
  columns: TColumns;
};

export type Entity = {
  name: string;
  columns: { id: Column<ID, false, false> } & Record<string, Column>;
};

export type Schema = {
  entities: readonly Entity[];
};

/**
 * Intermediate Type
 *
 * Type returned from createTable() or .addColumn() and accepted by createSchema()
 *
 * Is there something to name table so that it doesn't show up in intellisense
 */
export type IT<
  TTableName extends string | unknown = unknown,
  TColumns extends
    | ({ id: Column<ID, false, false> } & Record<string, Column>)
    | unknown = unknown
> = {
  table: Table<TTableName, TColumns>;
  addColumn: <
    TName extends string,
    TType extends Scalar,
    TOptional extends "id" extends TName ? false : boolean = false,
    TList extends "id" extends TName ? false : boolean = false
  >(
    name: TName,
    type: TType,
    modifiers?: { optional?: TOptional; list?: TList }
  ) => IT<
    TTableName,
    TColumns & Record<TName, Column<TType, TOptional, TList>>
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

export type RecoverTableType<TTable extends Table> = TTable extends {
  name: infer _name extends string;
  columns: infer _columns extends { id: Column<ID, false, false> } & Record<
    string,
    Column
  >;
}
  ? Record<
      _name,
      Prettify<
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
    >
  : never;
