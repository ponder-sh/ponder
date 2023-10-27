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

export type BaseColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` | never | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown
> = {
  type: TType;
  references: TReferences;
  optional: TOptional;
  list: TList;
};

export type IDColumn<TType extends ID = ID> = BaseColumn<
  TType,
  never,
  false,
  false
>;

export type ReferenceColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` | unknown = unknown,
  TOptional extends boolean | unknown = unknown
> = BaseColumn<TType, TReferences, TOptional, false>;

export type NonReferenceColumn<
  TType extends Scalar = Scalar,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown
> = BaseColumn<TType, never, TOptional, TList>;

// Note: should a list of enums be allowed?
export type EnumColumn<
  TType extends string | unknown = unknown,
  TOptional extends boolean | unknown = unknown
> = {
  _type: "e";
  type: TType;
  optional: TOptional;
};

export type VirtualColumn<
  TTableName extends string | unknown = unknown,
  TColumnName extends string | unknown = unknown
> = {
  _type: "v";
  referenceTable: TTableName;
  referenceColumn: TColumnName;
};

export type Column = BaseColumn | EnumColumn | VirtualColumn;

export type DefaultColumn =
  | ReferenceColumn<ID, `${string}.id`, boolean>
  | NonReferenceColumn<ID, boolean, boolean>
  | EnumColumn<string, boolean>
  | VirtualColumn<string, string>;

// Note: This is kinda unfortunate because table.id is no longer strongly typed, should however be better for users
export type Table<
  TColumns extends
    | ({
        id: IDColumn;
      } & Record<string, NonReferenceColumn | EnumColumn | VirtualColumn> &
        Record<`${string}Id`, ReferenceColumn>)
    | unknown =
    | ({
        id: IDColumn;
      } & Record<string, NonReferenceColumn | EnumColumn | VirtualColumn> &
        Record<`${string}Id`, ReferenceColumn>)
    | unknown
> = TColumns;

export type Enum<TValues extends string[] | unknown = string[] | unknown> =
  TValues;

export type Schema = {
  tables: Record<string, Table<Record<string, DefaultColumn>>>;
  enums: Record<string, Enum<string[]>>;
};

/**
 * Intermediate Type
 *
 * Type returned from createEnum()
 */
export type ITEnum<TValues extends string[] | unknown = unknown> = {
  /** @internal */
  isEnum: true;
  /** @internal */
  table: Record<string, Column>;
  values: TValues;
};

/**
 * Intermediate Type
 *
 * Type returned from createTable()
 */
export type ITTable<TTable extends Table | unknown = unknown> = {
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

export type RecoverColumnType<TColumn extends BaseColumn> = TColumn extends {
  type: infer _type extends Scalar;
}
  ? TColumn["list"] extends false
    ? RecoverScalarType<_type>
    : RecoverScalarType<_type>[]
  : never;

export type RecoverOptionalColumns<
  TColumns extends Record<string, BaseColumn>
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key]["optional"] extends true
      ? key
      : never;
  }[keyof TColumns]
>;

export type RecoverRequiredColumns<
  TColumns extends Record<string, BaseColumn>
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key]["optional"] extends false
      ? key
      : never;
  }[keyof TColumns]
>;

export type RecoverTableType<TTable extends Table> =
  TTable extends infer _columns extends {
    id: IDColumn;
  } & Record<string, BaseColumn>
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
