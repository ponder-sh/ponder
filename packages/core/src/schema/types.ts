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
  _type: "b";
  type: TType;
  references: TReferences;
  optional: TOptional;
  list: TList;
};

export type ReferenceColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` = `${string}.id`,
  TOptional extends boolean = boolean
> = BaseColumn<TType, TReferences, TOptional, false>;

export type NonReferenceColumn<
  TType extends Scalar = Scalar,
  TOptional extends boolean = boolean,
  TList extends boolean = boolean
> = BaseColumn<TType, never, TOptional, TList>;

// TODO: make sure that .column is not available when compiled
export type InternalColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` | never | unknown = unknown,
  TOptional extends boolean | unknown = unknown,
  TList extends boolean | unknown = unknown
> = {
  /** @internal */
  column: BaseColumn<TType, TReferences, TOptional, TList>;
};

export type IDColumn<TType extends ID = ID> = {
  column: BaseColumn<TType, never, false, false>;
};

export type InternalEnum<
  TType extends string | unknown = unknown,
  TOptional extends boolean | unknown = unknown
> = {
  /** @internal */
  enum: EnumColumn<TType, TOptional>;
};

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

// Note: This is kinda unfortunate because table.id is no longer strongly typed, should however be better for users
export type Table<
  TColumns extends
    | ({
        id: { column: IDColumn };
      } & Record<string, InternalEnum | InternalColumn | VirtualColumn>)
    | unknown =
    | ({
        id: { column: IDColumn };
      } & Record<string, InternalEnum | InternalColumn | VirtualColumn>)
    | unknown
> = TColumns;

export type Enum<
  TValues extends readonly string[] | unknown = readonly string[] | unknown
> = TValues;

export type Schema = {
  tables: Record<
    string,
    Table<
      Record<
        string,
        | NonReferenceColumn<Scalar, boolean, boolean>
        | ReferenceColumn<Scalar, `${string}.id`, boolean>
        | EnumColumn<string, boolean>
        | VirtualColumn<string, string>
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
        NonReferenceColumn | ReferenceColumn | EnumColumn | VirtualColumn
      >
    >
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
  TColumns extends Record<string, NonReferenceColumn | ReferenceColumn>
> = Pick<
  TColumns,
  {
    [key in keyof TColumns]: TColumns[key]["optional"] extends true
      ? key
      : never;
  }[keyof TColumns]
>;

export type RecoverRequiredColumns<
  TColumns extends Record<string, NonReferenceColumn | ReferenceColumn>
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
    id: BaseColumn<ID, never, false, false>;
  } & Record<string, ReferenceColumn | NonReferenceColumn>
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

export type RecoverSchemaType<TSchema extends Schema> = {
  [key in keyof TSchema["tables"]]: RecoverTableType<TSchema["tables"][key]>;
};
