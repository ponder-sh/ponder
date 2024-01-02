import type { NonReferenceColumn, Schema } from "./types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
  referencedTableName,
} from "./utils.js";

export const validateSchema = ({ schema }: { schema: Schema }): void => {
  // Validate enums
  Object.entries(schema.enums).forEach(([name, _enum]) => {
    validateTableOrColumnName(name, "Enum");

    // Make sure values aren't the same
    const set = new Set<string>();

    for (const val of _enum) {
      if (val in set)
        throw Error(
          `Validation failed: Enum contains duplicate values (enum=${name})`,
        );
      set.add(val);
    }
  });

  // Validate tables
  Object.entries(schema.tables).forEach(([name, table]) => {
    validateTableOrColumnName(name, "Table");

    // Validate the id column

    if (table.id === undefined)
      throw Error(
        `Validation failed: Table doesn't contain an "id" column (table=${name})`,
      );

    // NOTE: This is a to make sure the user didn't override the ID type
    // @ts-ignore
    const type = table.id.type;
    if (
      type !== "bigint" &&
      type !== "string" &&
      type !== "bytes" &&
      type !== "int"
    )
      throw Error(
        `Validation failed: "id" column cannot be type "${type}" (table=${name})`,
      );

    if (isEnumColumn(table.id))
      throw Error(
        `Validation failed: "id" column cannot be type "enum" (table=${name})`,
      );

    if (isOneColumn(table.id))
      throw Error(
        `Validation failed: "id" column cannot be type "one" (table=${name})`,
      );

    if (isManyColumn(table.id))
      throw Error(
        `Validation failed: "id" column cannot be type "many" (table=${name})`,
      );

    if (isReferenceColumn(table.id))
      throw Error(
        `Validation failed: "id" column cannot be type "reference" (table=${name})`,
      );

    // NOTE: This is a to make sure the user didn't override the optional type
    // @ts-ignore
    if (table.id.optional === true)
      throw Error(
        `Validation failed: "id" column cannot be optional (table=${table})`,
      );
    // NOTE: This is a to make sure the user didn't override the list type
    // @ts-ignore
    if (table.id.list === true)
      throw Error(`Validation failed: "id" cannot be a list (table=${table})`);

    // Validate all other columns
    Object.entries(table).forEach(([columnName, column]) => {
      if (columnName === "id") return;

      validateTableOrColumnName(columnName, "Column");

      if (isOneColumn(column)) {
        if (
          Object.keys(table)
            .filter((c) => c !== columnName)
            .every((c) => c !== column.referenceColumn) === undefined
        )
          throw Error(
            `Validation failed: "one" column doesn't reference a valid column (table=${name} column=${columnName} reference=${column.referenceColumn})`,
          );

        if (
          !isReferenceColumn(
            Object.entries(table).find(
              ([c]) => c === column.referenceColumn,
            )![1],
          )
        )
          throw Error(
            `Validation failed: "one" column doesn't reference a "reference" column (table=${name} column=${columnName} reference=${column.referenceColumn})`,
          );
      } else if (isManyColumn(column)) {
        if (
          Object.keys(schema.tables)
            .filter((_name) => _name !== name)
            .every((_name) => _name !== column.referenceTable)
        )
          throw Error(
            `Validation failed: "many" column doesn't reference a valid table (table=${name} column=${columnName} reference=${column.referenceTable})`,
          );

        if (
          (
            Object.entries(schema.tables).find(
              ([tableName]) => tableName === column.referenceTable,
            )![1] as Record<string, unknown>
          )[column.referenceColumn as string] === undefined
        )
          throw Error(
            `Validation failed: "many" column doesn't reference a valid column (table=${name} column=${columnName} referenceTable=${column.referenceTable}) referenceColumn=${column.referenceColumn}`,
          );
      } else if (isEnumColumn(column)) {
        if (
          Object.entries(schema.enums).every(([_name]) => _name !== column.type)
        )
          throw Error(
            `Validation failed: "enum" column doesn't reference a valid enum (table=${name} column=${columnName} type=${column.type})`,
          );
      } else if (isReferenceColumn(column)) {
        if (
          Object.keys(schema.tables).every(
            (_name) => `${_name}.id` !== column.references,
          )
        )
          throw Error(
            `Validation failed: Column with the "reference" modifier does not reference a valid table (table=${name} column=${columnName} reference=${column.references})`,
          );

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
              `Validation failed: Column with the "reference" modifier does not match the type of the referenced table's "id" column (table=${name} column=${columnName} type=${column.type} reference=${column.references})`,
            );
        }

        if (column.list)
          throw Error(
            `Validation failed: Column cannot have both the "reference" and "list" modifier (table=${name} column=${columnName})`,
          );
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
          throw Error(
            `Validation failed: Column is not a valid type (table=${name} column=${columnName} type=${column.type})`,
          );
      }
    });
  });
};

const validateTableOrColumnName = (key: string, type: string) => {
  if (key === "")
    throw Error(`Validation failed: ${type} name can't be an empty string`);

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error(
      `Validation failed: ${type} name contains an invalid character (name=${key})`,
    );
};
