import type { NonReferenceColumn, Schema } from "./types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
  referencedTableName,
} from "./utils.js";

export const validateSchema = ({ schema }: { schema: Schema }): void => {
  // validate enums
  Object.entries(schema.enums).forEach(([name, _enum]) => {
    validateTableOrColumnName(name);

    // Make sure values aren't the same
    const set = new Set<string>();

    for (const val of _enum) {
      if (val in set) throw Error("Enum contains duplicate values");
      set.add(val);
    }
  });

  // validate tables
  Object.entries(schema.tables).forEach(([name, table]) => {
    validateTableOrColumnName(name);

    if (Array.isArray(table)) {
      // Enum

      // Make sure values aren't the same
      const set = new Set<(typeof table)[number]>();

      for (const val of table) {
        if (val in set) throw Error("ITEnum contains duplicate values");
        set.add(val);
      }
    } else {
      // Table

      // Check the id property

      if (table.id === undefined)
        throw Error('Table doesn\'t contain an "id" field');

      // NOTE: This is a to make sure the user didn't override the ID type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const type = table.id.type;
      if (
        isEnumColumn(table.id) ||
        isOneColumn(table.id) ||
        isManyColumn(table.id) ||
        isReferenceColumn(table.id) ||
        (type !== "bigint" &&
          type !== "string" &&
          type !== "bytes" &&
          type !== "int")
      )
        throw Error('"id" is not of the correct type');
      // NOTE: This is a to make sure the user didn't override the optional type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (table.id.optional === true) throw Error('"id" cannot be optional');
      // NOTE: This is a to make sure the user didn't override the list type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (table.id.list === true) throw Error('"id" cannot be a list');
      // NOTE: This is a to make sure the user didn't override the reference type
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (table.id.references) throw Error('"id" cannot be a reference');

      Object.entries(table).forEach(([columnName, column]) => {
        if (columnName === "id") return;

        validateTableOrColumnName(columnName);

        if (isOneColumn(column)) {
          if (
            Object.keys(table)
              .filter((c) => c !== columnName)
              .every((c) => c !== column.referenceColumn) === undefined
          )
            throw Error("One column doesn't reference a valid column");

          if (
            !isReferenceColumn(
              Object.entries(table).find(
                ([c]) => c === column.referenceColumn,
              )![1],
            )
          )
            throw Error("One column doesn't reference a reference column");
        } else if (isManyColumn(column)) {
          if (
            Object.keys(schema.tables)
              .filter((_name) => _name !== name)
              .every((_name) => _name !== column.referenceTable)
          )
            throw Error("Many column doesn't reference a valid table");

          if (
            (
              Object.entries(schema.tables).find(
                ([tableName]) => tableName === column.referenceTable,
              )![1] as Record<string, unknown>
            )[column.referenceColumn as string] === undefined
          )
            throw Error("Many column doesn't reference a valid column");
        } else if (isEnumColumn(column)) {
          if (
            Object.entries(schema.enums).every(
              ([_name]) => _name !== column.type,
            )
          )
            throw Error("Column doesn't reference a valid enum");
        } else if (isReferenceColumn(column)) {
          if (
            Object.keys(schema.tables).every(
              (_name) => `${_name}.id` !== column.references,
            )
          )
            throw Error("Column doesn't reference a valid table");

          const referencingTables = Object.entries(schema.tables).filter(
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
};

const validateTableOrColumnName = (key: string) => {
  if (key === "") throw Error("Table to column name can't be an empty string");

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error("Table or column name contains an invalid character");
};
