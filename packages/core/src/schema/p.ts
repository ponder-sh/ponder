import { BaseColumn, InternalColumn, InternalEnum, Scalar } from "./types";

type Optional<
  TScalar extends Scalar,
  TReferences extends `${string}.id` | never,
  TList extends boolean
> = () => never extends TReferences
  ? TList extends true
    ? InternalColumn<TScalar, TReferences, true, TList>
    : InternalColumn<TScalar, TReferences, true, TList> & {
        list: List<TScalar, true>;
        references: References<TScalar, true>;
      }
  : InternalColumn<TScalar, TReferences, true, TList>;

/**
 * Helper function for optional modifier
 */
const optional = <
  TScalar extends Scalar,
  TReferences extends `${string}.id` | never,
  TList extends boolean
>(
  column: BaseColumn<TScalar, TReferences, false, TList>
): Optional<TScalar, TReferences, TList> =>
  (() => {
    const newColumn = { ...column, optional: true };

    return column.list || column.references !== undefined
      ? {
          column: newColumn,
        }
      : {
          column: newColumn,
          list: list(
            newColumn as unknown as BaseColumn<TScalar, never, true, false>
          ),
          references: references(
            newColumn as unknown as BaseColumn<TScalar, never, true, false>
          ),
        };
  }) as Optional<TScalar, TReferences, TList>;

type List<
  TScalar extends Scalar,
  TOptional extends boolean
> = () => TOptional extends true
  ? InternalColumn<TScalar, never, TOptional, true>
  : InternalColumn<TScalar, never, TOptional, true> & {
      optional: Optional<TScalar, never, true>;
    };

/**
 * Helper function for list modifier
 *
 * List columns can't be references
 */
const list = <TScalar extends Scalar, TOptional extends boolean>(
  column: BaseColumn<TScalar, never, TOptional, false>
): List<TScalar, TOptional> =>
  (() => {
    const newColumn = { ...column, list: true };
    return column.optional
      ? {
          column: newColumn,
        }
      : {
          column: newColumn,
          optional: optional(
            newColumn as BaseColumn<TScalar, never, false, true>
          ),
        };
  }) as List<TScalar, TOptional>;

type References<TScalar extends Scalar, TOptional extends boolean> = <
  TReferences extends `${string}.id`
>(
  references: TReferences
) => TOptional extends true
  ? InternalColumn<TScalar, TReferences, TOptional, false>
  : InternalColumn<TScalar, TReferences, TOptional, false> & {
      optional: Optional<TScalar, TReferences, false>;
    };

/**
 * Helper function for reference modifier
 *
 * Reference columns can't be lists
 */
const references = <TScalar extends Scalar, TOptional extends boolean>(
  column: BaseColumn<TScalar, never, TOptional, false>
): References<TScalar, TOptional> =>
  (<TReferences extends `${string}.id`>(references: TReferences) => {
    const newColumn = { ...column, references };

    return column.optional
      ? { column: newColumn }
      : {
          column: newColumn,
          optional: optional(
            newColumn as BaseColumn<TScalar, TReferences, false, false>
          ),
        };
  }) as References<TScalar, TOptional>;

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

type Enum<
  TType extends string,
  TOptional extends boolean
> = TOptional extends true
  ? InternalEnum<TType, TOptional>
  : InternalEnum<TType, TOptional> & {
      optional: () => Enum<TType, true>;
    };

const _enum = <TType extends string>(type: TType): Enum<TType, false> => ({
  enum: {
    _type: "e",
    type,
    optional: false,
  },
  optional: () => ({
    enum: {
      _type: "e",
      type,
      optional: true,
    },
  }),
});

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
  enum: _enum,
  // virtual: <TTableName extends string, TColumnName extends string>(
  //   derived: `${TTableName}.${TColumnName}`
  // ): VirtualColumn<TTableName, TColumnName> => ({
  //   _type: "v",
  //   referenceTable: derived.split(".")[0] as TTableName,
  //   referenceColumn: derived.split(".")[1] as TColumnName,
  // }),
} as const;
