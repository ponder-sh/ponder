import {
  Column,
  Enum,
  EnumColumn,
  FilterEnums,
  FilterNonEnums,
  IDColumn,
  ITEnum,
  ITTable,
  NonReferenceColumn,
  ReferenceColumn,
  Table,
  VirtualColumn,
} from "./types";
import {
  isEnumColumn,
  isReferenceColumn,
  isVirtualColumn,
  referencedEntityName,
} from "./utils";

export const createTable = <TTable extends Table>(
  table: TTable
): ITTable<TTable> => ({
  isEnum: false,
  table,
});

export const createEnum = <TEnum extends Enum>(arg: TEnum): ITEnum<TEnum> => ({
  isEnum: true,
  table: {},
  values: arg,
});

/**
 * Type inference and runtime validation
 */
export const createSchema = <
  TSchema extends Record<
    string,
    | ITTable<
        Table<
          Record<string, NonReferenceColumn | EnumColumn | VirtualColumn> &
            Record<`${string}Id`, ReferenceColumn>
        >
      >
    | ITEnum<string[]>
  >
>(schema: {
  [key in keyof TSchema]: TSchema[key]["table"] extends Table<{
    [columnName in keyof TSchema[key]["table"]]: TSchema[key]["table"][columnName] extends VirtualColumn
      ? VirtualColumn
      : TSchema[key]["table"][columnName] extends EnumColumn
      ? EnumColumn
      : TSchema[key]["table"][columnName] extends ReferenceColumn
      ? ReferenceColumn
      : TSchema[key]["table"][columnName] extends NonReferenceColumn
      ? NonReferenceColumn
      : never;
  }>
    ? TSchema[key]
    : TSchema[key]["isEnum"] extends true
    ? TSchema[key]
    : never;
}): {
  tables: { [key in keyof FilterNonEnums<TSchema>]: TSchema[key]["table"] };
  enums: {
    [key in keyof FilterEnums<TSchema>]: (TSchema[key] & ITEnum)["values"];
  };
} => {
  Object.entries(schema as TSchema).forEach(([name, tableOrEnum]) => {
    validateTableOrColumnName(name);

    if (tableOrEnum.isEnum) {
      // Make sure values aren't the same
      const set = new Set<(typeof tableOrEnum.values)[number]>();

      for (const val of tableOrEnum.values) {
        if (val in set) throw Error("ITEnum contains duplicate values");
        set.add(val);
      }
    } else {
      // Table

      // Check the id property

      if (tableOrEnum.table.id === undefined)
        throw Error('Table doesn\'t contain an "id" field');
      if (
        isVirtualColumn(tableOrEnum.table.id) ||
        isEnumColumn(tableOrEnum.table.id) ||
        isReferenceColumn(tableOrEnum.table.id) ||
        (tableOrEnum.table.id.type !== "bigint" &&
          tableOrEnum.table.id.type !== "string" &&
          tableOrEnum.table.id.type !== "bytes" &&
          tableOrEnum.table.id.type !== "int")
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

      Object.entries(tableOrEnum.table).forEach(
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
              Object.entries(schema).find(
                ([tableName]) => tableName === column.referenceTable
              )![1].table[column.referenceColumn as string] === undefined
            )
              throw Error("Virtual column doesn't reference a valid column");
          } else if (isEnumColumn(column)) {
            if (
              Object.entries(schema)
                .filter(([, table]) => table.isEnum)
                .every(([name]) => name !== (column.type as string).slice(5))
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

            const referencingTables = Object.entries(schema as TSchema).filter(
              ([name]) => name === referencedEntityName(column.references)
            );

            for (const [, referencingTable] of referencingTables) {
              if (
                (referencingTable.table as { id: IDColumn }).id.type !==
                column.type
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

  return Object.entries(schema as TSchema).reduce(
    (
      acc: {
        enums: Record<string, ITEnum["values"]>;
        tables: Record<string, Table>;
      },
      [tableName, table]
    ) =>
      table.isEnum
        ? { ...acc, enums: { ...acc.enums, [tableName]: table.values } }
        : {
            ...acc,
            tables: { ...acc.tables, [tableName]: table.table },
          },
    { tables: {}, enums: {} }
  ) as {
    tables: { [key in keyof FilterNonEnums<TSchema>]: TSchema[key]["table"] };
    enums: {
      [key in keyof FilterEnums<TSchema>]: (TSchema[key] & ITEnum)["values"];
    };
  };
};

const validateTableOrColumnName = (key: string) => {
  if (key === "") throw Error("Table to column name can't be an empty string");

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error("Table or column name contains an invalid character");
};
