import { Column, IT, Scalar, Table } from "./ts-types";

const _addColumn = <
  TTable extends Table,
  TName extends string,
  TType extends Scalar,
  TOptional extends boolean = false,
  TList extends boolean = false
>(
  table: TTable,
  name: TName,
  type: TType,
  modifiers?: { optional?: TOptional; list?: TList }
) =>
  ({
    ...table,
    [name]: {
      type,
      optional: modifiers?.optional ?? false,
      list: modifiers?.list ?? false,
    },
  } as Table<
    TTable["name"],
    TTable["columns"] & Record<TName, Column<TType, TOptional, TList>>
  >);

const addColumn = <
  TTable extends Table,
  TName extends string,
  TType extends Scalar,
  TOptional extends boolean = false,
  TList extends boolean = false
>(
  table: TTable,
  name: TName,
  type: TType,
  modifiers?: { optional?: TOptional; list?: TList }
): IT<
  TTable["name"],
  TTable["columns"] & Record<TName, Column<TType, TOptional, TList>>
> => {
  const newTable = _addColumn(table, name, type, modifiers);

  return {
    table: newTable,
    addColumn: <
      TName extends string,
      TType extends Scalar,
      TOptional extends boolean = false,
      TList extends boolean = false
    >(
      name: TName,
      type: TType,
      modifiers?: { optional?: TOptional; list?: TList }
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
      TName extends string,
      TType extends Scalar,
      TOptional extends boolean = false,
      TList extends boolean = false
    >(
      name: TName,
      type: TType,
      modifiers?: { optional?: TOptional; list?: TList }
    ): IT<TTableName, Record<TName, Column<TType, TOptional, TList>>> =>
      addColumn(table, name, type, modifiers),
  };
};

/**
 * Used for advanced type checking
 *
 * Every table must have an id field, and refernces must be strictly typed to the id field
 */
export const createSchema = (tables: IT[]) => tables.map((t) => t.table);
