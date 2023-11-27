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

const emptyColumn =
  <TScalar extends Scalar>(scalar: TScalar) =>
  (): InternalColumn<TScalar, undefined, false, false> & {
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
      optional: () => Enum<TType, true>;
    };

/**
 * Custom defined allowable value column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @param type Enum defined elsewhere in the schema with `p.createEnum()`.
 *
 * @example
 * export default p.createSchema({
 *   e: p.createEnum(["ONE", "TWO"])
 *   t: p.createTable({
 *     id: p.string(),
 *     a: p.enum("e"),
 *   })
 * })
 */
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
 * Primitive `string` column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   t: p.createTable({
 *     id: p.string(),
 *   })
 * })
 */
const string = emptyColumn("string");

/**
 * Primitive `int` column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   t: p.createTable({
 *     id: p.int(),
 *   })
 * })
 */
const int = emptyColumn("int");

/**
 * Primitive `float` column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   t: p.createTable({
 *     id: p.string(),
 *     f: p.float(),
 *   })
 * })
 */
const float = emptyColumn("float");

/**
 * Primitive `boolean` column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   t: p.createTable({
 *     id: p.string(),
 *     b: p.boolean(),
 *   })
 * })
 */
const boolean = emptyColumn("boolean");

/**
 * Primitive `bytes` column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   t: p.createTable({
 *     id: p.bytes(),
 *   })
 * })
 */
const bytes = emptyColumn("bytes");

/**
 * Primitive `bigint` column type.
 *
 * - Docs: [TODO:KYLE]
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   t: p.createTable({
 *     id: p.bigint(),
 *   })
 * })
 */
const bigint = emptyColumn("bigint");

/**
 * Many-to-one column type. `many` columns don't exist in the database. They are only present when querying data from the GraphQL API.
 *
 * - Docs: [TODO:KYLE]
 *
 * @param reference Reference column that references the `id` column of the current table.
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   a: p.createTable({
 *     id: p.string(),
 *     ref: p.string.references("b.id"),
 *   })
 *   b: p.createTable({
 *     id: p.string(),
 *     m: p.many("a.ref"),
 *   })
 * })
 */
const many = <T extends `${string}.${string}`>(derived: T): ManyColumn<T> =>
  ({
    _type: "m",
    referenceTable: derived.split(".")[0],
    referenceColumn: derived.split(".")[1],
  }) as ManyColumn<T>;

/**
 * One-to-one column type.`one` columns don't exist in the database. They are only present when querying data from the GraphQL API.
 *
 * - Docs: [TODO:KYLE]
 *
 * @param reference Reference column to be resolved.
 *
 * @example
 * import { p } from '@ponder/core'
 *
 * export default p.createSchema({
 *   a: p.createTable({
 *     id: p.string(),
 *     b_id: p.string.references("b.id"),
 *     b: p.one("b_id"),
 *   })
 *   b: p.createTable({
 *     id: p.string(),
 *   })
 * })
 */
const one = <T extends string>(derivedColumn: T): OneColumn<T> =>
  ({
    _type: "o",
    referenceColumn: derivedColumn,
  }) as OneColumn<T>;

export { _enum, bigint, boolean, bytes, float, int, many, one, string };
