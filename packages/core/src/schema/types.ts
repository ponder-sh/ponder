import type { Hex } from "viem";

import type { Prettify } from "@/types/utils.js";

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
  TReferences extends `${string}.id` | undefined | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown,
> = {
  _type: "b";
  type: TType;
  references: TReferences;
  optional: TOptional;
  list: TList;
};

export type ReferenceColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` = `${string}.id`,
  TOptional extends boolean = boolean,
> = BaseColumn<TType, TReferences, TOptional, false>;

export type NonReferenceColumn<
  TType extends Scalar = Scalar,
  TOptional extends boolean = boolean,
  TList extends boolean = boolean,
> = BaseColumn<TType, undefined, TOptional, TList>;

export type InternalColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` | undefined | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown,
> = {
  [" column"]: BaseColumn<TType, TReferences, TOptional, TList>;
};

export type IDColumn<TType extends ID = ID> = {
  [" column"]: BaseColumn<TType, undefined, false, false>;
};

export type InternalEnum<
  TType extends string | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown,
> = {
  [" enum"]: EnumColumn<TType, TOptional, TList>;
};

export type EnumColumn<
  TType extends string | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown,
> = {
  _type: "e";
  type: TType;
  optional: TOptional;
  list: TList;
};

export type ManyColumn<T extends `${string}.${string}` | unknown = unknown> =
  T extends `${infer TTableName extends string}.${infer TColumnName extends
    string}`
    ? {
        _type: "m";
        referenceTable: TTableName;
        referenceColumn: TColumnName;
      }
    : { _type: "m" };

export type OneColumn<T extends string | unknown = unknown> = T extends string
  ? {
      _type: "o";
      referenceColumn: T;
    }
  : { _type: "o" };

export type Table<
  TColumns extends
    | ({
        id: { [" column"]: IDColumn };
      } & Record<
        string,
        InternalEnum | InternalColumn | ManyColumn | OneColumn
      >)
    | unknown =
    | ({
        id: { [" column"]: IDColumn };
      } & Record<
        string,
        InternalEnum | InternalColumn | ManyColumn | OneColumn
      >)
    | unknown,
> = TColumns;

export type Enum<
  TValues extends readonly string[] | unknown = readonly string[] | unknown,
> = TValues;

export type Schema = {
  tables: Record<
    string,
    Table<
      { id: NonReferenceColumn<ID, false, false> } & Record<
        string,
        | NonReferenceColumn<Scalar, boolean, boolean>
        | ReferenceColumn<Scalar, `${string}.id`, boolean>
        | EnumColumn<string, boolean, boolean>
        | ManyColumn<`${string}.${string}`>
        | OneColumn<string>
      >
    >
  >;
  enums: Record<string, Enum<readonly string[]>>;
};

/**
 * Keeps only the enums from a schema
 */
export type FilterEnums<TSchema extends Record<string, Enum | Table>> = Pick<
  TSchema,
  {
    [key in keyof TSchema]: TSchema[key] extends Enum<readonly string[]>
      ? key
      : never;
  }[keyof TSchema]
>;

/**
 * Keeps only the tables from a schema
 */
export type FilterTables<TSchema extends Record<string, Enum | Table>> = Pick<
  TSchema,
  {
    [key in keyof TSchema]: TSchema[key] extends Table<
      Record<
        string,
        | NonReferenceColumn
        | ReferenceColumn
        | EnumColumn
        | ManyColumn
        | OneColumn
      >
    >
      ? key
      : never;
  }[keyof TSchema]
>;

/**
 * Keeps only the reference columns from a schema
 */
export type FilterReferenceColumns<
  TTableName extends string,
  TColumns extends
    | Record<
        string,
        | NonReferenceColumn
        | ReferenceColumn
        | EnumColumn
        | ManyColumn
        | OneColumn
      >
    | Enum,
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key] extends ReferenceColumn<
      Scalar,
      `${TTableName}.id`
    >
      ? key
      : never;
  }[keyof TColumns]
>;

export type ExtractAllNames<
  TTableName extends string,
  TSchema extends Record<
    string,
    | Record<
        string,
        | NonReferenceColumn
        | ReferenceColumn
        | EnumColumn
        | ManyColumn
        | OneColumn
      >
    | Enum
  >,
> = {
  [tableName in keyof FilterTables<TSchema>]: `${tableName &
    string}.${keyof FilterReferenceColumns<TTableName, TSchema[tableName]> &
    string}`;
}[keyof FilterTables<TSchema>];

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

export type RecoverColumnType<
  TColumn extends
    | NonReferenceColumn
    | ReferenceColumn
    | EnumColumn
    | ManyColumn
    | OneColumn,
> = TColumn extends {
  type: infer _type extends Scalar;
  list: infer _list extends boolean;
}
  ? _list extends false
    ? RecoverScalarType<_type>
    : RecoverScalarType<_type>[]
  : never;

export type RecoverOptionalColumns<
  TColumns extends Record<
    string,
    NonReferenceColumn | ReferenceColumn | EnumColumn | ManyColumn | OneColumn
  >,
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key] extends
      | NonReferenceColumn
      | ReferenceColumn
      ? TColumns[key]["optional"] extends true
        ? key
        : never
      : never;
  }[keyof TColumns]
>;

export type RecoverRequiredColumns<
  TColumns extends Record<
    string,
    NonReferenceColumn | ReferenceColumn | EnumColumn | ManyColumn | OneColumn
  >,
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key] extends
      | NonReferenceColumn
      | ReferenceColumn
      ? TColumns[key]["optional"] extends false
        ? key
        : never
      : never;
  }[keyof TColumns]
>;

export type RecoverOptionalEnumColumns<
  TColumns extends Record<
    string,
    NonReferenceColumn | ReferenceColumn | EnumColumn | ManyColumn | OneColumn
  >,
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key] extends EnumColumn
      ? TColumns[key]["optional"] extends true
        ? key
        : never
      : never;
  }[keyof TColumns]
>;

export type RecoverRequiredEnumColumns<
  TColumns extends Record<
    string,
    NonReferenceColumn | ReferenceColumn | EnumColumn | ManyColumn | OneColumn
  >,
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key] extends EnumColumn
      ? TColumns[key]["optional"] extends false
        ? key
        : never
      : never;
  }[keyof TColumns]
>;

export type RecoverEnumType<
  TEnums extends Record<string, Enum>,
  TColumn extends
    | NonReferenceColumn
    | ReferenceColumn
    | EnumColumn
    | ManyColumn
    | OneColumn,
> = TColumn extends EnumColumn
  ? TEnums[TColumn["type"] & keyof TEnums] extends infer _enum extends
      readonly string[]
    ? TColumn["list"] extends false
      ? _enum[number]
      : _enum[number][]
    : never
  : never;

export type RecoverTableType<
  TEnums extends Record<string, Enum>,
  TTable extends Table,
> = TTable extends infer _columns extends Record<
  string,
  ReferenceColumn | NonReferenceColumn | EnumColumn | ManyColumn | OneColumn
>
  ? Prettify<
      { id: RecoverColumnType<_columns["id"]> } & {
        [key in keyof RecoverRequiredColumns<_columns>]: RecoverColumnType<
          _columns[key]
        >;
      } & {
        [key in keyof RecoverOptionalColumns<_columns>]?: RecoverColumnType<
          _columns[key]
        >;
      } & {
        [key in keyof RecoverRequiredEnumColumns<_columns>]: RecoverEnumType<
          TEnums,
          _columns[key]
        >;
      } & {
        [key in keyof RecoverOptionalEnumColumns<_columns>]?: RecoverEnumType<
          TEnums,
          _columns[key]
        >;
      }
    >
  : never;

export type Infer<TSchema extends Schema> = {
  [key in keyof TSchema["tables"]]: RecoverTableType<
    TSchema["enums"],
    TSchema["tables"][key]
  >;
};
