import {
  type _Enum,
  _enum,
  bigint,
  boolean,
  bytes,
  type EmptyModifier,
  float,
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
  Schema,
  Table,
} from "./types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
  referencedTableName,
} from "./utils.js";

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
        id: { [" column"]: IDColumn };
      } & Record<
        string,
        InternalEnum | InternalColumn | ManyColumn | OneColumn
      >)
    | unknown =
    | ({
        id: { [" column"]: IDColumn };
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
      id: { [" column"]: IDColumn };
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
  bytes,
  boolean,
  one,
  many,
  enum: _enum,
};

type P = {
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
  string: () => EmptyModifier<"string">;
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
  int: () => EmptyModifier<"int">;
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
  float: () => EmptyModifier<"float">;
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
  bytes: () => EmptyModifier<"bytes">;
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
  boolean: () => EmptyModifier<"boolean">;
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
  bigint: () => EmptyModifier<"bigint">;
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
  enum: <TType extends string>(type: TType) => _Enum<TType, false, false>;
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
  one: <T extends string>(derivedColumn: T) => OneColumn<T>;
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
  many: <T extends `${string}.${string}`>(derived: T) => ManyColumn<T>;
  /**
   * Create an Enum type for the database.
   *
   * - Docs: [TODO:KYLE]
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
  createEnum: typeof createEnum;
  /**
   * Create a database table.
   *
   * - Docs: [TODO:KYLE]
   *
   * @example
   * export default p.createSchema({
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
 * - Docs: [TODO:KYLE]
 *
 * @example
 * export default p.createSchema({
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
  // Convert to an easier type to work with
  const schema = _schema(P) as Record<
    string,
    | Schema["tables"][keyof Schema["tables"]]
    | Schema["enums"][keyof Schema["enums"]]
  >;

  Object.entries(schema).forEach(([name, tableOrEnum]) => {
    validateTableOrColumnName(name);

    if (Array.isArray(tableOrEnum)) {
      // Enum

      // Make sure values aren't the same
      const set = new Set<(typeof tableOrEnum)[number]>();

      for (const val of tableOrEnum) {
        if (val in set) throw Error("ITEnum contains duplicate values");
        set.add(val);
      }
    } else {
      // Table

      // Check the id property

      if (tableOrEnum.id === undefined)
        throw Error('Table doesn\'t contain an "id" field');

      // NOTE: This is a to make sure the user didn't override the ID type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const type = tableOrEnum.id.type;
      if (
        isEnumColumn(tableOrEnum.id) ||
        isOneColumn(tableOrEnum.id) ||
        isManyColumn(tableOrEnum.id) ||
        isReferenceColumn(tableOrEnum.id) ||
        (type !== "bigint" &&
          type !== "string" &&
          type !== "bytes" &&
          type !== "int")
      )
        throw Error('"id" is not of the correct type');
      // NOTE: This is a to make sure the user didn't override the optional type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (tableOrEnum.id.optional === true)
        throw Error('"id" cannot be optional');
      // NOTE: This is a to make sure the user didn't override the list type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (tableOrEnum.id.list === true) throw Error('"id" cannot be a list');
      // NOTE: This is a to make sure the user didn't override the reference type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (tableOrEnum.id.references) throw Error('"id" cannot be a reference');

      Object.entries(tableOrEnum).forEach(([columnName, column]) => {
        if (columnName === "id") return;

        validateTableOrColumnName(columnName);

        if (isOneColumn(column)) {
          if (
            Object.keys(tableOrEnum)
              .filter((c) => c !== columnName)
              .every((c) => c !== column.referenceColumn) === undefined
          )
            throw Error("One column doesn't reference a valid column");

          if (
            !isReferenceColumn(
              Object.entries(tableOrEnum).find(
                ([c]) => c === column.referenceColumn,
              )![1],
            )
          )
            throw Error("One column doesn't reference a reference column");
        } else if (isManyColumn(column)) {
          if (
            Object.keys(schema)
              .filter((_name) => _name !== name)
              .every((_name) => _name !== column.referenceTable)
          )
            throw Error("Many column doesn't reference a valid table");

          if (
            (
              Object.entries(schema).find(
                ([tableName]) => tableName === column.referenceTable,
              )![1] as Record<string, unknown>
            )[column.referenceColumn as string] === undefined
          )
            throw Error("Many column doesn't reference a valid column");
        } else if (isEnumColumn(column)) {
          if (Object.entries(schema).every(([_name]) => _name !== column.type))
            throw Error("Column doesn't reference a valid enum");
        } else if (isReferenceColumn(column)) {
          if (!columnName.endsWith("Id")) {
            throw Error('Reference column name must end with "Id"');
          }

          if (
            Object.keys(schema).every(
              (_name) => `${_name}.id` !== column.references,
            )
          )
            throw Error("Column doesn't reference a valid table");

          const referencingTables = Object.entries(schema).filter(
            ([name]) => name === referencedTableName(column.references),
          );

          for (const [, referencingTable] of referencingTables) {
            if (
              Array.isArray(referencingTable) ||
              (referencingTable as { id: NonReferenceColumn }).id.type !==
                column.type
            )
              throw Error(
                "Column type doesn't match the referenced table id type",
              );
          }

          if (column.list)
            throw Error("Columns can't be both refernce and list types");
        } else {
          // Non reference column
          if (
            column.type !== "bigint" &&
            column.type !== "string" &&
            column.type !== "boolean" &&
            column.type !== "int" &&
            column.type !== "float" &&
            column.type !== "bytes"
          )
            throw Error("Column is not a valid type");
        }
      });
    }
  });

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

const validateTableOrColumnName = (key: string) => {
  if (key === "") throw Error("Table to column name can't be an empty string");

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error("Table or column name contains an invalid character");
};
