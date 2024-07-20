import {
  type BuilderEnumColumn,
  type BuilderIndex,
  type BuilderJSONColumn,
  type BuilderManyColumn,
  type BuilderOneColumn,
  type BuilderScalarColumn,
  _enum,
  bigint,
  boolean,
  float,
  hex,
  index,
  int,
  json,
  many,
  one,
  string,
} from "./columns.js";
import type {
  Column,
  Constraints,
  EnumColumn,
  ExtractEnumNames,
  ExtractNonVirtualColumnNames,
  ExtractReferenceColumnNames,
  ExtractTableNames,
  IdColumn,
  Index,
  JSONColumn,
  ManyColumn,
  OneColumn,
  ReferenceColumn,
  ScalarColumn,
  Schema,
  Table,
} from "./common.js";

type GetTable<
  table,
  tableName extends string = string,
  schema = {},
  ///
  tableNames extends string = {} extends schema
    ? string
    : ExtractTableNames<schema>,
  enumNames extends string = {} extends schema
    ? string
    : ExtractEnumNames<schema>,
> = {} extends table
  ? {}
  : table extends {
        id: IdColumn;
      }
    ? {
        [columnName in keyof table]: table[columnName] extends ScalarColumn
          ? ScalarColumn
          : table[columnName] extends ReferenceColumn
            ? ReferenceColumn<
                table[columnName][" scalar"],
                table[columnName][" optional"],
                `${tableNames}.id`
              >
            : table[columnName] extends JSONColumn
              ? JSONColumn
              : table[columnName] extends OneColumn
                ? OneColumn<Exclude<keyof table & string, columnName | "id">>
                : table[columnName] extends ManyColumn
                  ? {} extends schema
                    ? ManyColumn
                    : table[columnName] extends ManyColumn<tableNames>
                      ? ManyColumn<
                          table[columnName][" referenceTable"],
                          ExtractReferenceColumnNames<
                            schema[table[columnName][" referenceTable"] &
                              keyof schema],
                            tableName
                          > &
                            string
                        >
                      : ManyColumn<Exclude<tableNames, tableName>>
                  : table[columnName] extends EnumColumn
                    ? EnumColumn<enumNames>
                    : Column;
      }
    : { id: IdColumn } & {
        [columnName: string]: Column;
      };

type GetConstraints<
  constraints,
  table,
  ///
  columnName extends string = ExtractNonVirtualColumnNames<table>,
> = {} extends constraints
  ? {}
  : {
      [name in keyof constraints]: Index<columnName | readonly columnName[]>;
    };

export const createTable = <const table, const constraints>(
  t: GetTable<table>,
  c?: GetConstraints<constraints, table>,
): { table: table; constraints: constraints } => ({
  table: t as table,
  constraints: c as constraints,
});

export const createEnum = <const _enum extends readonly string[]>(e: _enum) =>
  e;

const P = {
  createTable,
  createEnum,
  string,
  bigint,
  int,
  float,
  hex,
  boolean,
  json,
  one,
  many,
  enum: _enum,
  index,
};

type P = {
  /**
   * Create a database table.
   *
   * - Docs: https://ponder.sh/docs/schema#tables
   *
   * @example
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.string(),
   *   })
   * }));
   */
  createTable: <const table, const constraints>(
    t: GetTable<table>,
    c?: GetConstraints<constraints, table>,
  ) => { table: table; constraints: constraints };
  /**
   * Create an Enum type for the database.
   *
   * - Docs: https://ponder.sh/docs/schema#tables
   *
   * @example
   * export default createSchema((p) => ({
   *   e: p.createEnum(["ONE", "TWO"])
   *   t: p.createTable({
   *     id: p.string(),
   *     a: p.enum("e"),
   *   })
   * }));
   */

  createEnum: <const _enum extends readonly string[]>(e: _enum) => _enum;
  /**
   * Primitive `string` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.string(),
   *   })
   * }));
   */
  string: () => BuilderScalarColumn<"string", false, false>;
  /**
   * Primitive `bigint` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.bigint(),
   *   })
   * }));
   */
  bigint: () => BuilderScalarColumn<"bigint", false, false>;
  /**
   * Primitive `int` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.int(),
   *   })
   * }));
   */
  int: () => BuilderScalarColumn<"int", false, false>;
  /**
   * Primitive `float` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.string(),
   *     f: p.float(),
   *   })
   * }));
   */

  float: () => BuilderScalarColumn<"float", false, false>;
  /**
   * Primitive `hex` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.hex(),
   *   })
   * }));
   */
  hex: () => BuilderScalarColumn<"hex", false, false>;
  /**
   * Primitive `boolean` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.string(),
   *     b: p.boolean(),
   *   })
   * }));
   */
  boolean: () => BuilderScalarColumn<"boolean", false, false>;
  /**
   * Primitive `JSON` column type.
   *
   * - Docs: https://ponder.sh/docs/schema#primitives
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.string(),
   *     b: p.json(),
   *   })
   * }));
   */
  json: <type = any>() => BuilderJSONColumn<type, false>;
  /**
   * One-to-one column type.`one` columns don't exist in the database. They are only present when querying data from the GraphQL API.
   *
   * - Docs: https://ponder.sh/docs/schema#one-to-one
   *
   * @param reference Reference column to be resolved.
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   a: p.createTable({
   *     id: p.string(),
   *     b_id: p.string.references("b.id"),
   *     b: p.one("b_id"),
   *   })
   *   b: p.createTable({
   *     id: p.string(),
   *   })
   * }));
   */
  one: <reference extends string>(
    ref: reference,
  ) => BuilderOneColumn<reference>;
  /**
   * Many-to-one column type. `many` columns don't exist in the database. They are only present when querying data from the GraphQL API.
   *
   * - Docs: https://ponder.sh/docs/schema#one-to-many
   *
   * @param reference Reference column that references the `id` column of the current table.
   *
   * @example
   * import { createSchema } from "@ponder/core";
   *
   * export default createSchema((p) => ({
   *   a: p.createTable({
   *     id: p.string(),
   *     ref: p.string.references("b.id"),
   *   })
   *   b: p.createTable({
   *     id: p.string(),
   *     m: p.many("a.ref"),
   *   })
   * }));
   */
  many: <referenceTable extends string, referenceColumn extends string>(
    ref: `${referenceTable}.${referenceColumn}`,
  ) => BuilderManyColumn<referenceTable, referenceColumn>;
  /**
   * Custom defined allowable value column type.
   *
   * - Docs: https://ponder.sh/docs/schema#enum
   *
   * @param type Enum defined elsewhere in the schema with `p.createEnum()`.
   *
   * @example
   * export default createSchema((p) => ({
   *   e: p.createEnum(["ONE", "TWO"])
   *   t: p.createTable({
   *     id: p.string(),
   *     a: p.enum("e"),
   *   })
   * }));
   */
  enum: <_enum extends string>(
    __enum: _enum,
  ) => BuilderEnumColumn<_enum, false, false>;
  /**
   * Create a table index.
   *
   * - Docs: https://ponder.sh/docs/schema#indexes
   *
   * @param columns Column or columns to include in the index.
   *
   * @example
   * export default createSchema((p) => ({
   *   t: p.createTable({
   *     id: p.string(),
   *     age: p.int(),
   *   }, {
   *     ageIndex: p.index("age"),
   *   })
   * }));
   */
  index: <const column extends string | readonly string[]>(
    c: column,
  ) => BuilderIndex<column, undefined, undefined>;
};

type CreateSchemaParameters<schema> = {} extends schema
  ? {}
  : {
      [tableName in keyof schema]: schema[tableName] extends {
        table: infer table extends Table;
        constraints: infer constraints extends Constraints;
      }
        ? {
            table: GetTable<table, tableName & string, schema>;
            constraints: GetConstraints<constraints, table>;
          }
        : readonly string[];
    };

export const createSchema = <const schema>(
  _schema: (p: P) => CreateSchemaParameters<schema>,
): unknown extends schema ? Schema : schema => {
  // @ts-ignore
  return _schema(P) as schema;
};
