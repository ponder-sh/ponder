import { BaseColumn, InternalColumn, Scalar } from "./types";

type Optional<
  TScalar extends Scalar,
  TReferences extends `${string}.id` | never,
  TList extends boolean
> = () => InternalColumn<TScalar, TReferences, true, TList>;

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
  ): Optional<TScalar, TReferences, TList> =>
  () => ({
    column: { ...column, optional: true },
  });

type List<
  TScalar extends Scalar,
  TOptional extends boolean
> = () => InternalColumn<TScalar, never, TOptional, true>;

/**
 * Helper function for list modifier
 *
 * List columns can't be references
 */
const list =
  <TScalar extends Scalar, TOptional extends boolean>(
    column: BaseColumn<TScalar, never, TOptional, false>
  ): List<TScalar, TOptional> =>
  () => ({
    column: { ...column, list: true },
  });

type References<TScalar extends Scalar, TOptional extends boolean> = <
  TReferences extends `${string}.id`
>(
  references: TReferences
) => InternalColumn<TScalar, TReferences, TOptional, false>;

/**
 * Helper function for reference modifier
 *
 * Reference columns can't be lists
 */
const references =
  <TScalar extends Scalar, TOptional extends boolean>(
    column: BaseColumn<TScalar, never, TOptional, false>
  ): References<TScalar, TOptional> =>
  <TReferences extends `${string}.id`>(references: TReferences) => ({
    column: { ...column, references },
  });

const emptyColumn =
  <TScalar extends Scalar>(scalar: TScalar) =>
  (): InternalColumn<TScalar, never, false, false> & {
    optional: Optional<TScalar, never, false>;
    list: List<TScalar, false>;
    references: References<TScalar, false>;
  } => {
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
