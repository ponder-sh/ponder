import { Column, ID, IT, Scalar, Table } from "./types";

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
    noSpaces(t.name);

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

    Object.keys(t.columns).forEach((key) => {
      if (key === "id") return;

      noSpaces(key);

      if (t.columns[key].references) {
        if (
          tables
            .filter((_t) => _t.name !== t.name)
            .every((_t) => `${_t.name}.id` !== t.columns[key].references)
        )
          throw Error("Column doesn't reference a valid table");

        if (
          tables.find(
            (_t) =>
              _t.name === (t.columns[key].references as String).split(".")[0]
          )!.columns.id.type !== t.columns[key].type
        )
          throw Error("Column type doesn't match the referred table id type");

        if (t.columns[key].list)
          throw Error("Columns can't be both refernce and list types");
      } else if (
        t.columns[key].type !== "bigint" &&
        t.columns[key].type !== "string" &&
        t.columns[key].type !== "boolean" &&
        t.columns[key].type !== "int" &&
        t.columns[key].type !== "float" &&
        t.columns[key].type !== "bytes"
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

const noSpaces = (name: string) => {
  if (name.includes(" ")) throw Error("Table or column name contains a space");
};
