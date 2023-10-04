import { Column, IT, Scalar, Table } from "./ts-types";

const _addColumn = <
  TTable extends Table,
  TName extends string,
  TType extends Scalar
>(
  table: TTable,
  name: TName,
  type: TType
) =>
  ({
    ...table,
    [name]: { type, optional: false, list: false },
  } as Table<
    TTable["name"],
    TTable["columns"] & Record<TName, Column<TType, false, false>>
  >);

const addColumn = <
  TTable extends Table,
  TName extends string,
  TType extends Scalar
>(
  table: TTable,
  name: TName,
  type: TType
): IT<
  TTable["name"],
  TTable["columns"] & Record<TName, Column<TType, false, false>>
> => {
  const newTable = _addColumn(table, name, type);

  return {
    table: newTable,
    addColumn: <TName extends string, TType extends Scalar>(
      name: TName,
      type: TType
    ) => addColumn(newTable, name, type),
  };
};

export const createTable = <TTableName extends string>(
  name: TTableName
): IT<TTableName, {}> => {
  const table = { name, columns: {} } as const;

  return {
    table,
    addColumn: <TName extends string, TType extends Scalar>(
      name: TName,
      type: TType
    ): IT<TTableName, Record<TName, Column<TType, false, false>>> =>
      addColumn(table, name, type),
  };
};

/**
 * Used for advanced type checking
 *
 * Every table must have an id field, and refernces must be strictly typed to the id field
 */
export const createSchema = (tables: Table[]) => tables;
