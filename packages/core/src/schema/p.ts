import { ID, Scalar } from "./types";

// Helper function for scalar ponder columns
const _p =
  <TScalar extends Scalar>(s: TScalar) =>
  <
    TReferences extends `${string}.id` | never = never,
    TOptional extends boolean = false,
    TList extends boolean = false
  >(modifiers?: {
    references?: TReferences;
    optional?: TOptional;
    list?: TList;
  }): BaseColumn<TScalar, TReferences, TOptional, TList> =>
    ({
      type: s,
      references: modifiers?.references ?? undefined,
      optional: modifiers?.optional ?? false,
      list: modifiers?.list ?? false,
    } as BaseColumn<TScalar, TReferences, TOptional, TList>);

/**
 * Column values in a Ponder schema
 */
export const p = {
  string: _p("string"),
  int: _p("int"),
  float: _p("float"),
  boolean: _p("boolean"),
  bytes: _p("bytes"),
  bigint: _p("bigint"),
  enum: <TType extends string = string, TOptional extends boolean = boolean>(
    type: TType,
    modifiers?: { optional?: TOptional }
  ): EnumColumn<TType, TOptional> =>
    ({
      type,
      optional: modifiers?.optional ?? false,
    } as EnumColumn<TType, TOptional>),
  virtual: <TTableName extends string, TColumnName extends string>(
    derived: `${TTableName}.${TColumnName}`
  ): VirtualColumn<TTableName, TColumnName> => ({
    referenceTable: derived.split(".")[0] as TTableName,
    referenceColumn: derived.split(".")[1] as TColumnName,
  }),
} as const satisfies Record<
  | "string"
  | "int"
  | "float"
  | "boolean"
  | "bytes"
  | "bigint"
  | "enum"
  | "virtual",
  (...a: any) => BaseColumn | EnumColumn | VirtualColumn
>;

export type BaseColumn<
  TType extends Scalar = Scalar,
  TReferences extends `${string}.id` | never = `${string}.id` | never,
  TOptional extends boolean = boolean,
  TList extends boolean = boolean
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
  TType extends ID = ID,
  TReferences extends `${string}.id` = `${string}.id`,
  TOptional extends boolean = boolean
> = BaseColumn<TType, TReferences, TOptional, false>;

export type NonReferenceColumn<
  TType extends ID = ID,
  TOptional extends boolean = boolean,
  TList extends boolean = boolean
> = BaseColumn<TType, never, TOptional, TList>;

// Note: should a list of enums be allowed?
export type EnumColumn<
  TType extends string = string,
  TOptional extends boolean = boolean
> = {
  type: TType;
  optional: TOptional;
};

export type VirtualColumn<
  TTableName extends string = string,
  TColumnName extends string = string
> = {
  referenceTable: TTableName;
  referenceColumn: TColumnName;
};
