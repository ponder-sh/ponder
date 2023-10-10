import { Column, ID, IT, Scalar, Table } from "./types";

export const referencedEntityName = (references: unknown) =>
  (references as string).split(".")[0];

const _addColumn = <
  TTables extends readonly Table[],
  TTable extends Table,
  TName extends string,
  TType extends Scalar,
  TReferneces extends "id" extends TName
    ? never
    : `${(TTables & Table[])[number]["name"] & string}.id`,
  TOptional extends "id" extends TName ? false : boolean = false,
  TList extends "id" extends TName ? false : boolean = false
>(
  table: TTable,
  name: TName,
  type: TType,
  modifiers?: {
    references?: TReferneces;
    optional?: TOptional;
    list?: TList;
  }
) =>
  ({
    ...table,
    columns: {
      ...(table.columns as object),
      [name]: {
        type,
        references: modifiers?.references ?? undefined,
        optional: modifiers?.optional ?? false,
        list: modifiers?.list ?? false,
      },
    },
  } as Table<
    TTable["name"],
    TTable["columns"] &
      Record<TName, Column<TTables, TType, TReferneces, TOptional, TList>>
  >);

const addColumn = <
  TTables extends readonly Table[],
  TTable extends Table,
  TName extends string,
  TType extends Scalar,
  TReferneces extends "id" extends TName
    ? never
    : `${(TTables & Table[])[number]["name"] & string}.id`,
  TOptional extends "id" extends TName ? false : boolean = false,
  TList extends "id" extends TName ? false : boolean = false
>(
  table: TTable,
  name: TName,
  type: TType,
  modifiers?: {
    references?: TReferneces;
    optional?: TOptional;
    list?: TList;
  }
): IT<
  TTable["name"],
  TTable["columns"] &
    Record<TName, Column<TTables, TType, TReferneces, TOptional, TList>>
> => {
  const newTable = _addColumn(table, name, type, modifiers);

  return {
    table: newTable,
    addColumn: <
      TTables extends readonly Table[],
      TName extends string,
      TType extends Scalar,
      TReferneces extends "id" extends TName
        ? never
        : `${(TTables & Table[])[number]["name"] & string}.id`,
      TOptional extends "id" extends TName ? false : boolean = false,
      TList extends "id" extends TName ? false : boolean = false
    >(
      name: TName,
      type: TType,
      modifiers?: {
        references?: TReferneces;
        optional?: TOptional;
        list?: TList;
      }
    ) => addColumn(newTable, name, type, modifiers),
  };
};

export const createTable = <TTableName extends string>(
  name: TTableName
): IT<TTableName, {}> => {
  const table = { name, columns: {} } as const;

  return {
    table,
    addColumn: <
      TTables extends readonly Table[],
      TName extends string,
      TType extends Scalar,
      TReferneces extends "id" extends TName
        ? never
        : `${(TTables & Table[])[number]["name"] & string}.id`,
      TOptional extends "id" extends TName ? false : boolean = false,
      TList extends "id" extends TName ? false : boolean = false
    >(
      name: TName,
      type: TType,
      modifiers?: {
        references?: TReferneces;
        optional?: TOptional;
        list?: TList;
      }
    ): IT<
      TTableName,
      Record<TName, Column<TTables, TType, TReferneces, TOptional, TList>>
    > => addColumn(table, name, type, modifiers),
  };
};

/**
 * Type inference and runtime validation
 */
export const createSchema = <
  TSchema extends readonly IT<
    string,
    { id: Column<Table[], ID, never, false, false> } & Record<
      string,
      Column<Table[], Scalar, unknown, boolean, boolean>
    >
  >[]
>(
  schema: TSchema
): {
  entities: { [key in keyof TSchema]: TSchema[key]["table"] };
} => {
  const tables = schema.map((it) => it.table);

  tables.forEach((t) => {
    verifyKey(t.name);

    if (t.columns.id === undefined)
      throw Error('Table doesn\'t contain an "id" field');
    if (
      t.columns.id.type !== "bigint" &&
      t.columns.id.type !== "string" &&
      t.columns.id.type !== "bytes" &&
      t.columns.id.type !== "int"
    )
      throw Error('"id" is not of the correct type');
    // NOTE: This is a to make sure the user didn't override the optional type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (t.columns.id.optional === true) throw Error('"id" cannot be optional');
    // NOTE: This is a to make sure the user didn't override the list type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (t.columns.id.list === true) throw Error('"id" cannot be a list');
    // NOTE: This is a to make sure the user didn't override the reference type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (t.columns.id.references) throw Error('"id" cannot be a reference');

    Object.entries(t.columns).forEach(([columnName, column]) => {
      if (columnName === "id") return;

      verifyKey(columnName);

      if (column.references) {
        if (
          tables
            .filter((_t) => _t.name !== t.name)
            .every((_t) => `${_t.name}.id` !== column.references)
        )
          throw Error("Column doesn't reference a valid table");

        if (
          tables.find(
            (_t) => _t.name === referencedEntityName(column.references)
          )!.columns.id.type !== column.type
        )
          throw Error("Column type doesn't match the referred table id type");

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

  return { entities: tables } as {
    entities: {
      [key in keyof TSchema]: TSchema[key]["table"];
    };
  };
};

const verifyKey = (key: string) => {
  if (key === "") throw Error("Table to column name can't be an empty string");

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error("Table or column name contains an invalid character");
};
