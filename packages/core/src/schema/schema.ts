import {
  Column,
  Enum,
  EnumColumn,
  FilterEnums,
  FilterTables,
  Table,
  VirtualColumn,
} from "./types";
import {
  isEnumColumn,
  isReferenceColumn,
  isVirtualColumn,
  referencedEntityName,
} from "./utils";

/**
 * Fix issue with Array.isArray not checking readonly arrays
 * {@link https://github.com/microsoft/TypeScript/issues/17002}
 */
declare global {
  interface ArrayConstructor {
    isArray(arg: ReadonlyArray<any> | any): arg is ReadonlyArray<any>;
  }
}

export const createTable = <TTable extends Table>(table: TTable) => table;

/**
 * @todo const type assertions is needed, might have to update vitest
 */
export const createEnum = <TEnum extends Enum>(_enum: TEnum) => _enum;

/**
 * Type inference and runtime validation
 */
export const createSchema = <
  TSchema extends Record<
    string,
    Table<Record<string, Column>> | Enum<readonly string[]>
  >
>(schema: {
  [key in keyof TSchema]: TSchema[key] extends Table<{
    [columnName in keyof TSchema[key]]: TSchema[key][columnName] extends VirtualColumn
      ? VirtualColumn
      : TSchema[key][columnName] extends EnumColumn
      ? EnumColumn
      : TSchema[key][columnName] extends ReferenceColumn
      ? ReferenceColumn
      : TSchema[key][columnName] extends NonReferenceColumn
      ? NonReferenceColumn
      : never;
  }>
    ? TSchema[key]
    : TSchema[key] extends Enum
    ? TSchema[key]
    : never;
}): {
  tables: { [key in keyof FilterTables<TSchema>]: TSchema[key] };
  enums: {
    [key in keyof FilterEnums<TSchema>]: TSchema[key];
  };
} => {
  Object.entries(schema).forEach(([name, tableOrEnum]) => {
    validateTableOrColumnName(name);

    if (Array.isArray(tableOrEnum)) {
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
      if (
        tableOrEnum.id.type !== "bigint" &&
        tableOrEnum.id.type !== "string" &&
        tableOrEnum.id.type !== "bytes" &&
        tableOrEnum.id.type !== "int"
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

      Object.entries(tableOrEnum).forEach(
        ([columnName, column]: [string, Column]) => {
          if (columnName === "id") return;

          validateTableOrColumnName(columnName);

          if (isVirtualColumn(column)) {
            if (
              Object.keys(schema)
                .filter((_name) => _name !== name)
                .every((_name) => _name !== column.referenceTable)
            )
              throw Error("Virtual column doesn't reference a valid table");

            if (
              (
                Object.entries(schema).find(
                  ([tableName]) => tableName === column.referenceTable
                )![1] as Record<string, unknown>
              )[column.referenceColumn as string] === undefined
            )
              throw Error("Virtual column doesn't reference a valid column");
          } else if (isEnumColumn(column)) {
            if (
              Object.entries(schema).every(([_name]) => _name !== column.type)
            )
              throw Error("Column doesn't reference a valid enum");
          } else if (isReferenceColumn(column)) {
            if (!columnName.endsWith("Id")) {
              throw Error('Reference column name must end with "Id"');
            }

            if (
              Object.keys(schema)
                .filter((_name) => _name !== name)
                .every((_name) => `${_name}.id` !== column.references)
            )
              throw Error("Column doesn't reference a valid table");

            const referencingTables = Object.entries(schema).filter(
              ([name]) => name === referencedEntityName(column.references)
            );

            for (const [, referencingTable] of referencingTables) {
              if (
                Array.isArray(referencingTable) ||
                referencingTable.id.column.type !== column.type
              )
                throw Error(
                  "Column type doesn't match the referenced table id type"
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
        }
      );
    }
  });

  return Object.entries(schema).reduce(
    (
      acc: {
        enums: Record<string, Enum>;
        tables: Record<string, Table>;
      },
      [name, tableOrEnum]
    ) =>
      Array.isArray(tableOrEnum)
        ? { ...acc, enums: { ...acc.enums, [name]: tableOrEnum } }
        : {
            ...acc,
            tables: { ...acc.tables, [name]: tableOrEnum },
          },
    { tables: {}, enums: {} }
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
