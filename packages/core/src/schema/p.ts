import { BaseColumn, EnumColumn, Scalar, VirtualColumn } from "./types";

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
  enum: <TType extends string = string, TOptional extends boolean = false>(
    type: TType,
    modifiers?: { optional?: TOptional }
  ): EnumColumn<TType, TOptional> =>
    ({
      _type: "e",
      type,
      optional: modifiers?.optional ?? false,
    } as EnumColumn<TType, TOptional>),
  virtual: <TTableName extends string, TColumnName extends string>(
    derived: `${TTableName}.${TColumnName}`
  ): VirtualColumn<TTableName, TColumnName> => ({
    _type: "v",
    referenceTable: derived.split(".")[0] as TTableName,
    referenceColumn: derived.split(".")[1] as TColumnName,
  }),
} as const;
