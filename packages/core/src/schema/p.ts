import { BaseColumn, InternalColumn, Scalar } from "./types";

/**
 * Helper function for optional modifier
 */
const optional =
  <
    TScalar extends Scalar,
    TReferences extends `${string}.id` | never,
    TList extends boolean
  >(
    column: BaseColumn<TScalar, TReferences, false, TList>
  ) =>
  (): InternalColumn<TScalar, TReferences, true, TList> => ({
    column: { ...column, optional: true },
  });

/**
 * Helper function for list modifier
 *
 * List columns can't be references
 */
const list =
  <TScalar extends Scalar, TOptional extends boolean>(
    column: BaseColumn<TScalar, never, TOptional, false>
  ) =>
  (): InternalColumn<TScalar, never, TOptional, true> => ({
    column: { ...column, list: true },
  });

/**
 * Helper function for reference modifier
 *
 * Reference columns can't be lists
 */
const references =
  <TScalar extends Scalar, TOptional extends boolean>(
    column: BaseColumn<TScalar, never, TOptional, false>
  ) =>
  <TReferences extends `${string}.id`>(
    references: TReferences
  ): InternalColumn<TScalar, TReferences, TOptional, false> => ({
    column: { ...column, references },
  });

const emptyColumn =
  <TScalar extends Scalar>(scalar: TScalar) =>
  () => {
    const column = {
      type: scalar,
      references: undefined,
      optional: false,
      list: false,
    } as BaseColumn<TScalar, never, false, false>;

    return {
      column,
      optional: optional(column),
      list: list(column),
      references: references(column),
    };
  };

/**
 * Column values in a Ponder schema
 */
export const p = {
  string: emptyColumn("string"),
  int: emptyColumn("int"),
  float: emptyColumn("float"),
  boolean: emptyColumn("boolean"),
  bytes: emptyColumn("bytes"),
  bigint: emptyColumn("bigint"),
  // enum: <TType extends string = string, TOptional extends boolean = false>(
  //   type: TType,
  //   modifiers?: { optional?: TOptional }
  // ): EnumColumn<TType, TOptional> =>
  //   ({
  //     _type: "e",
  //     type,
  //     optional: modifiers?.optional ?? false,
  //   } as EnumColumn<TType, TOptional>),
  // virtual: <TTableName extends string, TColumnName extends string>(
  //   derived: `${TTableName}.${TColumnName}`
  // ): VirtualColumn<TTableName, TColumnName> => ({
  //   _type: "v",
  //   referenceTable: derived.split(".")[0] as TTableName,
  //   referenceColumn: derived.split(".")[1] as TColumnName,
  // }),
} as const;
