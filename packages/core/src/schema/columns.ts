import type {
  BaseColumn,
  InternalColumn,
  InternalEnum,
  ManyColumn,
  OneColumn,
  Scalar,
} from "./types.js";

type Optional<
  TScalar extends Scalar,
  TReferences extends `${string}.id` | undefined,
  TList extends boolean,
> = () => TReferences extends undefined
  ? TList extends true
    ? InternalColumn<TScalar, TReferences, true, TList>
    : InternalColumn<TScalar, TReferences, true, TList> & {
        /**
         * Mark the column as optional.
         *
         * - Docs: [TODO:KYLE]
         *
         * @example
         * import { p } from '@ponder/core'
         *
         * export default p.createSchema({
         *   t: p.createTable({
         *     id: p.string(),
         *     o: p.int().optional(),
         *   })
         * })
         */
        list: List<TScalar, true>;
        /**
         * Mark the column as a foreign key.
         *
         * - Docs: [TODO:KYLE]
         *
         * @param references Table that this column is a key of.
         *
         * @example
         * import { p } from '@ponder/core'
         *
         * export default p.createSchema({
         *   a: p.createTable({
         *     id: p.string(),
         *     b_id: p.string.references("b.id"),
         *   })
         *   b: p.createTable({
         *     id: p.string(),
         *   })
         * })
         */
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
      /**
       * Mark the column as optional.
       *
       * - Docs: [TODO:KYLE]
       *
       * @example
       * import { p } from '@ponder/core'
       *
       * export default p.createSchema({
       *   t: p.createTable({
       *     id: p.string(),
       *     o: p.int().optional(),
       *   })
       * })
       */
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
      /**
       * Mark the column as optional.
       *
       * - Docs: [TODO:KYLE]
       *
       * @example
       * import { p } from '@ponder/core'
       *
       * export default p.createSchema({
       *   t: p.createTable({
       *     id: p.string(),
       *     o: p.int().optional(),
       *   })
       * })
       */
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

export type EmptyModifier<TScalar extends Scalar> = InternalColumn<
  TScalar,
  undefined,
  false,
  false
> & {
  /**
   * Mark the column as optional.
   *
   * - Docs: [TODO:KYLE]
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default p.createSchema({
   *   t: p.createTable({
   *     id: p.string(),
   *     o: p.int().optional(),
   *   })
   * })
   */
  optional: Optional<TScalar, undefined, false>;
  /**
   * Mark the column as a list.
   *
   * - Docs: [TODO:KYLE]
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default p.createSchema({
   *   t: p.createTable({
   *     id: p.string(),
   *     l: p.int().list(),
   *   })
   * })
   */
  list: List<TScalar, false>;
  /**
   * Mark the column as a foreign key.
   *
   * - Docs: [TODO:KYLE]
   *
   * @param references Table that this column is a key of.
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default p.createSchema({
   *   a: p.createTable({
   *     id: p.string(),
   *     b_id: p.string.references("b.id"),
   *   })
   *   b: p.createTable({
   *     id: p.string(),
   *   })
   * })
   */
  references: References<TScalar, false>;
};

const emptyColumn =
  <TScalar extends Scalar>(scalar: TScalar) =>
  (): EmptyModifier<TScalar> => {
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

export type _Enum<
  TType extends string,
  TOptional extends boolean,
  TList extends boolean,
> = InternalEnum<TType, TOptional, TList> &
  (TOptional extends true
    ? {}
    : {
        /**
         * Mark the column as optional.
         *
         * - Docs: [TODO:KYLE]
         *
         * @example
         * import { p } from '@ponder/core'
         *
         * export default p.createSchema({
         *   e: p.createEnum(["ONE", "TWO"])
         *   t: p.createTable({
         *     id: p.string(),
         *     a: p.enum("e").optional(),
         *   })
         * })
         */
        optional: () => _Enum<TType, true, TList>;
      }) &
  (TList extends true
    ? {}
    : {
        /**
         * Mark the column as a list.
         *
         * - Docs: [TODO:KYLE]
         *
         * @example
         * import { p } from '@ponder/core'
         *
         * export default p.createSchema({
         *   e: p.createEnum(["ONE", "TWO"])
         *   t: p.createTable({
         *     id: p.string(),
         *     a: p.enum("e").list(),
         *   })
         * })
         */
        list: () => _Enum<TType, TOptional, true>;
      });

export const _enum = <TType extends string>(
  type: TType,
): _Enum<TType, false, false> => ({
  [" enum"]: {
    _type: "e",
    type,
    optional: false,
    list: false,
  },
  optional: () => ({
    [" enum"]: {
      _type: "e",
      type,
      optional: true,
      list: false,
    },
    list: () => ({
      [" enum"]: {
        _type: "e",
        type,
        optional: true,
        list: true,
      },
    }),
  }),

  list: () => ({
    [" enum"]: {
      _type: "e",
      type,
      list: true,
      optional: false,
    },
    optional: () => ({
      [" enum"]: {
        _type: "e",
        type,
        optional: true,
        list: true,
      },
    }),
  }),
});

export const string = emptyColumn("string");
export const int = emptyColumn("int");
export const float = emptyColumn("float");
export const boolean = emptyColumn("boolean");
export const bytes = emptyColumn("bytes");
export const bigint = emptyColumn("bigint");

export const one = <T extends string>(derivedColumn: T): OneColumn<T> =>
  ({
    _type: "o",
    referenceColumn: derivedColumn,
  }) as OneColumn<T>;

export const many = <T extends `${string}.${string}`>(
  derived: T,
): ManyColumn<T> =>
  ({
    _type: "m",
    referenceTable: derived.split(".")[0],
    referenceColumn: derived.split(".")[1],
  }) as ManyColumn<T>;
