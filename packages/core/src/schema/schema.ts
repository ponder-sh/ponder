import {
  type EmptyModifier,
  type _Enum,
  _enum,
  bigint,
  boolean,
  float,
  hex,
  int,
  many,
  one,
  string,
} from "./columns.js";
import type {
  Enum,
  EnumColumn,
  ExtractAllNames,
  FilterEnums,
  FilterTables,
  ID,
  IDColumn,
  InternalColumn,
  InternalEnum,
  ManyColumn,
  NonReferenceColumn,
  OneColumn,
  ReferenceColumn,
  Scalar,
  Table,
} from "./types.js";

/**
 * Fix issue with Array.isArray not checking readonly arrays
 * {@link https://github.com/microsoft/TypeScript/issues/17002}
 */
declare global {
  interface ArrayConstructor {
    isArray(arg: ReadonlyArray<any> | any): arg is ReadonlyArray<any>;
  }
}

export const createTable = <
  TColumns extends
    | ({
        id: { " column": IDColumn };
      } & Record<
        string,
        InternalEnum | InternalColumn | ManyColumn | OneColumn
      >)
    | unknown =
    | ({
        id: { " column": IDColumn };
      } & Record<
        string,
        InternalEnum | InternalColumn | ManyColumn | OneColumn
      >)
    | unknown,
>(
  columns: TColumns,
): {
  [key in keyof TColumns]: TColumns[key] extends InternalColumn
    ? TColumns[key][" column"]
    : TColumns[key] extends InternalEnum
      ? TColumns[key][" enum"]
      : TColumns[key];
} =>
  Object.entries(
    columns as {
      id: { " column": IDColumn };
    } & Record<string, InternalEnum | InternalColumn | ManyColumn | OneColumn>,
  ).reduce(
    (
      acc: Record<
        string,
        | NonReferenceColumn
        | ReferenceColumn
        | EnumColumn
        | ManyColumn
        | OneColumn
      >,
      cur,
    ) => ({
      ...acc,
      [cur[0]]:
        " column" in cur[1]
          ? (cur[1][" column"] as NonReferenceColumn | ReferenceColumn)
          : " enum" in cur[1]
            ? cur[1][" enum"]
            : cur[1],
    }),
    {},
  ) as {
    [key in keyof TColumns]: TColumns[key] extends InternalColumn
      ? TColumns[key][" column"]
      : TColumns[key] extends InternalEnum
        ? TColumns[key][" enum"]
        : TColumns[key];
  };

export const createEnum = <const TEnum extends Enum>(_enum: TEnum) => _enum;

const P = {
  createEnum,
  createTable,
  string,
  bigint,
  int,
  float,
  hex,
  boolean,
  one,
  many,
  enum: _enum,
};

type P = {
  /**
   * Primitive `string` column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#primitives
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.string(),
   *   })
   * })
   */
  string: () => EmptyModifier<"string">;
  /**
   * Primitive `int` column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#primitives
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.int(),
   *   })
   * })
   */
  int: () => EmptyModifier<"int">;
  /**
   * Primitive `float` column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#primitives
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.string(),
   *     f: p.float(),
   *   })
   * })
   */
  float: () => EmptyModifier<"float">;
  /**
   * Primitive `hex` column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#primitives
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.hex(),
   *   })
   * })
   */
  hex: () => EmptyModifier<"hex">;
  /**
   * Primitive `boolean` column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#primitives
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.string(),
   *     b: p.boolean(),
   *   })
   * })
   */
  boolean: () => EmptyModifier<"boolean">;
  /**
   * Primitive `bigint` column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#primitives
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.bigint(),
   *   })
   * })
   */
  bigint: () => EmptyModifier<"bigint">;
  /**
   * Custom defined allowable value column type.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#enum
   *
   * @param type Enum defined elsewhere in the schema with `p.createEnum()`.
   *
   * @example
   * export default createSchema({
   *   e: p.createEnum(["ONE", "TWO"])
   *   t: p.createTable({
   *     id: p.string(),
   *     a: p.enum("e"),
   *   })
   * })
   */
  enum: <TType extends string>(type: TType) => _Enum<TType, false, false>;
  /**
   * One-to-one column type.`one` columns don't exist in the database. They are only present when querying data from the GraphQL API.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#one-to-one
   *
   * @param reference Reference column to be resolved.
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
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
  one: <T extends string>(derivedColumn: T) => OneColumn<T>;
  /**
   * Many-to-one column type. `many` columns don't exist in the database. They are only present when querying data from the GraphQL API.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#one-to-many
   *
   * @param reference Reference column that references the `id` column of the current table.
   *
   * @example
   * import { p } from '@ponder/core'
   *
   * export default createSchema({
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
  many: <T extends `${string}.${string}`>(derived: T) => ManyColumn<T>;
  /**
   * Create an Enum type for the database.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#tables
   *
   * @example
   * export default createSchema({
   *   e: p.createEnum(["ONE", "TWO"])
   *   t: p.createTable({
   *     id: p.string(),
   *     a: p.enum("e"),
   *   })
   * })
   */
  createEnum: typeof createEnum;
  /**
   * Create a database table.
   *
   * - Docs: https://ponder.sh/docs/guides/design-your-schema#tables
   *
   * @example
   * export default createSchema({
   *   t: p.createTable({
   *     id: p.string(),
   *   })
   * })
   */
  createTable: typeof createTable;
};

/**
 * Create a database schema.
 *
 * - Docs: https://ponder.sh/docs/guides/design-your-schema#tables
 *
 * @example
 * export default createSchema({
 *   t: p.createTable({
 *     id: p.string(),
 *   })
 * })
 */
export const createSchema = <
  TSchema extends {
    [tableName in keyof TSchema]:
      | ({ id: NonReferenceColumn<ID, false, false> } & {
          [columnName in keyof TSchema[tableName]]:
            | NonReferenceColumn
            | ReferenceColumn<
                Scalar,
                `${keyof FilterTables<TSchema> & string}.id`
              >
            | EnumColumn<keyof FilterEnums<TSchema>, boolean, boolean>
            | ManyColumn<ExtractAllNames<tableName & string, TSchema>>
            | OneColumn<Exclude<keyof TSchema[tableName], columnName>>;
        })
      | Enum<readonly string[]>;
  },
>(
  _schema: (p: P) => TSchema,
): {
  tables: { [key in keyof FilterTables<TSchema>]: TSchema[key] };
  enums: {
    [key in keyof FilterEnums<TSchema>]: TSchema[key];
  };
} => {
  const schema = _schema(P);
  return Object.entries(schema).reduce(
    (
      acc: {
        enums: Record<string, Enum>;
        tables: Record<string, Table>;
      },
      [name, tableOrEnum],
    ) =>
      Array.isArray(tableOrEnum)
        ? { ...acc, enums: { ...acc.enums, [name]: tableOrEnum } }
        : {
            ...acc,
            tables: { ...acc.tables, [name]: tableOrEnum },
          },
    { tables: {}, enums: {} },
  ) as {
    tables: { [key in keyof FilterTables<TSchema>]: TSchema[key] };
    enums: {
      [key in keyof FilterEnums<TSchema>]: TSchema[key];
    };
  };
};
