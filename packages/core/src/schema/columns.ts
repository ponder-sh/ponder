import type {
  BaseColumn,
  InternalColumn,
  InternalEnum,
  Scalar,
  VirtualColumn,
} from "./types.js";

type Optional<
  TScalar extends Scalar,
  TReferences extends `${string}.id` | undefined,
  TList extends boolean,
> = () => TReferences extends undefined
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
  TReferences extends `${string}.id` | undefined,
  TList extends boolean,
>(
  column: BaseColumn<TScalar, TReferences, false, TList>,
): Optional<TScalar, TReferences, TList> =>
  (() => {
    const newColumn = { ...column, optional: true } as const;

    return column.list || column.references !== undefined
      ? {
          [" column"]: newColumn,
        }
      : {
          [" column"]: newColumn,
          list: list(newColumn as BaseColumn<TScalar, undefined, true, false>),
          references: references(
            newColumn as BaseColumn<TScalar, undefined, true, false>,
          ),
        };
  }) as Optional<TScalar, TReferences, TList>;

type List<
  TScalar extends Scalar,
  TOptional extends boolean,
> = () => TOptional extends true
  ? InternalColumn<TScalar, undefined, TOptional, true>
  : InternalColumn<TScalar, undefined, TOptional, true> & {
      optional: Optional<TScalar, undefined, true>;
    };

/**
 * Helper function for list modifier
 *
 * List columns can't be references
 */
const list = <TScalar extends Scalar, TOptional extends boolean>(
  column: BaseColumn<TScalar, undefined, TOptional, false>,
): List<TScalar, TOptional> =>
  (() => {
    const newColumn = { ...column, list: true } as const;
    return column.optional
      ? {
          [" column"]: newColumn,
        }
      : {
          [" column"]: newColumn,
          optional: optional(
            newColumn as BaseColumn<TScalar, undefined, false, true>,
          ),
        };
  }) as List<TScalar, TOptional>;

type References<TScalar extends Scalar, TOptional extends boolean> = <
  TReferences extends `${string}.id`,
>(
  references: TReferences,
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
  column: BaseColumn<TScalar, undefined, TOptional, false>,
): References<TScalar, TOptional> =>
  (<TReferences extends `${string}.id`>(references: TReferences) => {
    const newColumn = { ...column, references } as const;

    return column.optional
      ? { [" column"]: newColumn }
      : {
          [" column"]: newColumn,
          optional: optional(
            newColumn as BaseColumn<TScalar, TReferences, false, false>,
          ),
        };
  }) as References<TScalar, TOptional>;

const emptyColumn =
  <TScalar extends Scalar>(scalar: TScalar) =>
  (): InternalColumn<TScalar, undefined, false, false> & {
    optional: Optional<TScalar, undefined, false>;
    list: List<TScalar, false>;
    references: References<TScalar, false>;
  } => {
    const column = {
      _type: "b",
      type: scalar,
      references: undefined,
      optional: false,
      list: false,
    } as const;

    return {
      [" column"]: column,
      optional: optional(column),
      list: list(column),
      references: references(column),
    };
  };

type Enum<
  TType extends string,
  TOptional extends boolean,
> = TOptional extends true
  ? InternalEnum<TType, TOptional>
  : InternalEnum<TType, TOptional> & {
      optional: () => Enum<TType, true>;
    };

const _enum = <TType extends string>(type: TType): Enum<TType, false> => ({
  [" enum"]: {
    _type: "e",
    type,
    optional: false,
  },
  optional: () => ({
    [" enum"]: {
      _type: "e",
      type,
      optional: true,
    },
  }),
});

/**
 * Column values in a Ponder schema
 */
const string = emptyColumn("string");
const int = emptyColumn("int");
const float = emptyColumn("float");
const boolean = emptyColumn("boolean");
const bytes = emptyColumn("bytes");
const bigint = emptyColumn("bigint");

const many = <T extends `${string}.${string}`>(derived: T): VirtualColumn<T> =>
  ({
    _type: "v",
    referenceTable: derived.split(".")[0],
    referenceColumn: derived.split(".")[1],
  }) as VirtualColumn<T>;

export { _enum, bigint, boolean, bytes, float, int, many, string };
