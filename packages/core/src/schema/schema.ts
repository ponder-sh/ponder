import {
  Column,
  FilterEnums,
  FilterNonEnums,
  ITEnum,
  ITTable,
  Scalar,
  Table,
} from "./types";

export const referencedEntityName = (references: unknown) =>
  (references as string).split(".")[0];

export const isEnumType = (type: string): type is `enum:${string}` =>
  type.slice(0, 5) === "enum:";

export const stripId = <T extends string>(columnName: `${T}Id`): T =>
  columnName.slice(0, -2) as T;

export const column = <
  TType extends Scalar | `enum:${string}`,
  TReferences extends `${string}.id` | never = never,
  TOptional extends boolean = false,
  TList extends boolean = false
>(
  type: TType,
  modifiers?: {
    references?: TReferences;
    optional?: TOptional;
    list?: TList;
  }
) =>
  ({
    type,
    references: modifiers?.references ?? undefined,
    optional: modifiers?.optional ?? false,
    list: modifiers?.list ?? false,
  } as Column<TType, TReferences, TOptional, TList>);

export const table = <TTable extends Table>(
  table: TTable
): ITTable<TTable> => ({
  isEnum: false,
  table,
});

export const enumerable = <TValues extends string[]>(
  ...args: TValues
): ITEnum<TValues> => ({ isEnum: true, table: {}, values: args });

/**
 * Type inference and runtime validation
 *
 * No idea why the "any" works
 * : `${keyof TSchema & string}.id`
 */
export const createSchema = <
  TSchema extends Record<string, ITTable<any> | ITEnum>
>(schema: {
  [key in keyof TSchema]: TSchema[key]["table"] extends Table<{
    [columnName in keyof TSchema[key]["table"]]: TSchema[key]["table"][columnName]["references"] extends never
      ? Column<
          Scalar | `enum:${keyof FilterEnums<TSchema> & string}`,
          never,
          TSchema[key]["table"][columnName]["optional"],
          TSchema[key]["table"][columnName]["list"]
        >
      : columnName extends `${string}Id`
      ? Column<
          Scalar | `enum:${keyof FilterEnums<TSchema> & string}`,
          `${keyof TSchema & string}.id`,
          TSchema[key]["table"][columnName]["optional"],
          TSchema[key]["table"][columnName]["list"]
        >
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
  Object.entries(schema as TSchema).forEach(([tableName, table]) => {
    validateTableOrColumnName(tableName);

    if (table.isEnum) {
      // Make sure values aren't the same
      const set = new Set<(typeof table.values)[number]>();

      for (const val of table.values) {
        if (val in set) throw Error("ITEnum contains duplicate values");
        set.add(val);
      }
    } else {
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

      Object.entries(table.table).forEach(([columnName, _column]) => {
        if (columnName === "id") return;

        validateTableOrColumnName(columnName);

        const column = _column as Column;

        if (column.references) {
          if (!columnName.endsWith("Id")) {
            throw Error('Reference column name must end with "Id"');
          }

          if (
            Object.keys(schema)
              .filter((name) => name !== tableName)
              .every((name) => `${name}.id` !== column.references)
          )
            throw Error("Column doesn't reference a valid table");

          const referencingTables = Object.entries(schema as TSchema).filter(
            ([name]) => name === referencedEntityName(column.references)
          );

          for (const [, referencingTable] of referencingTables) {
            if (referencingTable.table.id.type !== column.type)
              throw Error(
                "Column type doesn't match the referenced table id type"
              );
          }

          if (column.list)
            throw Error("Columns can't be both refernce and list types");
        } else if (isEnumType(column.type as string)) {
          if (
            Object.entries(schema)
              .filter(([, table]) => table.isEnum)
              .every(([name]) => name !== (column.type as string).slice(5))
          )
            throw Error("Column doesn't reference a valid enum");
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
