import { Column, ID, IT, Scalar, Table } from "./types";

export const referencedEntityName = (references: unknown) =>
  (references as string).split(".")[0];

const _addColumn = <
  TColumns extends Record<string, Column>,
  TName extends string,
  TType extends Scalar,
  TReferences extends `${string}.id` | never = never,
  TOptional extends boolean = false,
  TList extends boolean = false
>(
  columns: TColumns,
  name: TName,
  type: TType,
  modifiers?: {
    references?: TReferences;
    optional?: TOptional;
    list?: TList;
  }
) =>
  ({
    ...columns,
    [name]: {
      type,
      references: modifiers?.references ?? undefined,
      optional: modifiers?.optional ?? false,
      list: modifiers?.list ?? false,
    },
  } as Table<
    TColumns & Record<TName, Column<TType, TReferences, TOptional, TList>>
  >);

const addColumn = <
  TColumns extends Record<string, Column>,
  TName extends string,
  TType extends Scalar,
  TReferences extends `${string}.id` | never = never,
  TOptional extends boolean = false,
  TList extends boolean = false
>(
  columns: TColumns,
  name: TName,
  type: TType,
  modifiers?: {
    references?: TReferences;
    optional?: TOptional;
    list?: TList;
  }
): IT<
  TColumns & Record<TName, Column<TType, TReferences, TOptional, TList>>
> => {
  const newTable = _addColumn(columns, name, type, modifiers);

  return {
    table: newTable,
    addColumn: <
      TName extends string,
      TType extends Scalar,
      TReferences extends `${string}.id` | never = never,
      TOptional extends boolean = false,
      TList extends boolean = false
    >(
      name: TName,
      type: TType,
      modifiers?: {
        references?: TReferences;
        optional?: TOptional;
        list?: TList;
      }
    ) => addColumn(newTable, name, type, modifiers),
  };
};

export const createColumn = <TType extends ID>(name: "id", type: TType) =>
  addColumn({}, name, type);

/**
 * Type inference and runtime validation
 */
export const createSchema = <TSchema extends Record<string, IT>>(schema: {
  [key in keyof TSchema]: TSchema[key]["table"] extends Table<{
    [columnName in keyof TSchema[key]["table"]]: Column<
      TSchema[key]["table"][columnName]["type"],
      TSchema[key]["table"][columnName]["references"] extends never
        ? never
        : `${keyof TSchema & string}.id`,
      TSchema[key]["table"][columnName]["optional"],
      TSchema[key]["table"][columnName]["list"]
    >;
  }>
    ? TSchema[key]
    : never;
}): { [key in keyof TSchema]: TSchema[key]["table"] } => {
  Object.entries(schema as TSchema).forEach(([tableName, table]) => {
    verifyKey(tableName);

    if (table.table.id === undefined)
      throw Error('Table doesn\'t contain an "id" field');
    if (
      table.table.id.type !== "bigint" &&
      table.table.id.type !== "string" &&
      table.table.id.type !== "bytes" &&
      table.table.id.type !== "int"
    )
      throw Error('"id" is not of the correct type');
    // NOTE: This is a to make sure the user didn't override the optional type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (table.table.id.optional === true)
      throw Error('"id" cannot be optional');
    // NOTE: This is a to make sure the user didn't override the list type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (table.table.id.list === true) throw Error('"id" cannot be a list');
    // NOTE: This is a to make sure the user didn't override the reference type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (table.table.id.references) throw Error('"id" cannot be a reference');

    Object.entries(table.table).forEach(([columnName, column]) => {
      if (columnName === "id") return;

      verifyKey(columnName);

      if (column.references) {
        if (
          Object.keys(schema)
            .filter((name) => name !== tableName)
            .every((name) => `${name}.id` !== column.references)
        )
          throw Error("Column doesn't reference a valid table");

        // TODO:Kyle Allow for multiple references in the same table
        const referencingTables = Object.entries(schema as TSchema).filter(
          ([name]) => name === referencedEntityName(column.references)
        );

        for (const [, referencingTable] of referencingTables) {
          if (referencingTable.table.id.type !== column.type)
            throw Error("Column type doesn't match the referred table id type");
        }

        if (column.list)
          throw Error("Columns can't be both refernce and list types");
      } else if (
        column.type !== "bigint" &&
        column.type !== "string" &&
        column.type !== "boolean" &&
        column.type !== "int" &&
        column.type !== "float" &&
        column.type !== "bytes"
      )
        throw Error("Column is not a valid type");
    });
  });

  return Object.entries(schema as TSchema).reduce(
    (acc: Record<string, Table>, [tableName, table]) => ({
      ...acc,
      [tableName]: table.table,
    }),
    {}
  ) as { [key in keyof TSchema]: TSchema[key]["table"] };
};

const verifyKey = (key: string) => {
  if (key === "") throw Error("Table to column name can't be an empty string");

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error("Table or column name contains an invalid character");
};
