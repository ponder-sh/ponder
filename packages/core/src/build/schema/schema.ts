import type { Schema } from "../../schema/types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
  referencedTableName,
} from "../../schema/utils.js";

export const buildSchema = ({ schema }: { schema: Schema }) => {
  // Validate enums
  Object.entries(schema.enums).forEach(([name, _enum]) => {
    validateTableOrColumnName(name, "Enum");

    const enumValues = new Set<string>();
    for (const enumValue of _enum) {
      if (enumValues.has(enumValue)) {
        throw Error(
          `Validation failed: Enum '${name}' contains duplicate value '${enumValue}'.`,
        );
      }
      enumValues.add(enumValue);
    }
  });

  // Validate tables
  Object.entries(schema.tables).forEach(([tableName, columns]) => {
    validateTableOrColumnName(tableName, "Table");

    // Validate the id column
    if (columns.id === undefined)
      throw Error(
        `Validation failed: Table '${tableName}' does not have an 'id' column.`,
      );

    if (isEnumColumn(columns.id))
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'enum', expected one of ['string', 'hex', 'bigint', 'int'].`,
      );
    if (isOneColumn(columns.id))
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'one', expected one of ['string', 'hex', 'bigint', 'int'].`,
      );
    if (isManyColumn(columns.id))
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'many', expected one of ['string', 'hex', 'bigint', 'int'].`,
      );
    if (isReferenceColumn(columns.id))
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. ID columns cannot use the '.references' modifier.`,
      );

    if (
      columns.id.type !== "bigint" &&
      columns.id.type !== "string" &&
      columns.id.type !== "hex" &&
      columns.id.type !== "int"
    )
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. Got '${columns.id.type}', expected one of ['string', 'hex', 'bigint', 'int'].`,
      );

    // @ts-expect-error
    if (columns.id.optional === true)
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. ID columns cannot be optional.`,
      );
    // @ts-expect-error
    if (columns.id.list === true)
      throw Error(
        `Validation failed: Invalid type for ID column '${tableName}.id'. ID columns cannot be a list.`,
      );

    // Validate all other columns
    Object.entries(columns).forEach(([columnName, column]) => {
      if (columnName === "id") return;

      validateTableOrColumnName(columnName, "Column");

      if (isOneColumn(column)) {
        const usedColumn = Object.entries(columns).find(
          ([c]) => c === column.referenceColumn,
        );

        if (usedColumn === undefined) {
          const otherColumns = Object.keys(columns).filter(
            (c) => c !== columnName,
          );
          throw Error(
            `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that does not exist. Got '${
              column.referenceColumn
            }', expected one of [${otherColumns
              .map((c) => `'${c}'`)
              .join(", ")}].`,
          );
        }

        if (!isReferenceColumn(usedColumn[1])) {
          const foreignKeyColumns = Object.keys(columns).filter(
            (c) => c !== columnName && isReferenceColumn(columns[c]),
          );
          throw Error(
            `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that is not foreign key column. Got '${
              column.referenceColumn
            }', expected one of [${foreignKeyColumns
              .map((c) => `'${c}'`)
              .join(", ")}].`,
          );
        }
      }

      if (isManyColumn(column)) {
        const usedTable = Object.entries(schema.tables).find(
          ([name]) => name === column.referenceTable,
        );

        if (usedTable === undefined) {
          const otherTables = Object.keys(schema.tables).filter(
            (t) => t !== tableName,
          );

          throw Error(
            `Validation failed. Relationship column '${tableName}.${columnName}' uses a table that does not exist. Got '${
              column.referenceTable
            }', expected one of [${otherTables
              .map((t) => `'${t}'`)
              .join(", ")}].`,
          );
        }

        const usedTableColumns = Object.entries(usedTable[1]);
        const usedColumn = usedTableColumns.find(
          ([columnName]) => columnName === column.referenceColumn,
        );

        if (usedColumn === undefined) {
          throw Error(
            `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that does not exist. Got '${
              column.referenceTable
            }.${column.referenceColumn}', expected one of [${usedTableColumns
              .map((c) => `'${usedTable[0]}.${c}'`)
              .join(", ")}].`,
          );
        }

        if (!isReferenceColumn(usedColumn[1])) {
          const foreignKeyColumnNames = usedTableColumns.filter(([, c]) =>
            isReferenceColumn(c),
          );
          throw Error(
            `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that is not foreign key column. Got '${
              column.referenceTable
            }.${
              column.referenceColumn
            }', expected one of [${foreignKeyColumnNames
              .map((c) => `'${usedTable[0]}.${c}'`)
              .join(", ")}].`,
          );
        }
      }

      if (isEnumColumn(column)) {
        const referencedEnum = Object.entries(schema.enums).find(
          ([enumName]) => enumName === column.type,
        );
        if (referencedEnum === undefined) {
          throw Error(
            `Validation failed: Enum column '${tableName}.${columnName}' doesn't reference a valid enum. Got '${
              column.type
            }', expected one of [${Object.keys(schema.enums)
              .map((e) => `'${e}'`)
              .join(", ")}].`,
          );
        }
      }

      if (isReferenceColumn(column)) {
        const referencedTable = Object.entries(schema.tables).find(
          ([tableName]) => tableName === referencedTableName(column.references),
        );

        if (referencedTable === undefined) {
          throw Error(
            `Validation failed: Foreign key column '${tableName}.${columnName}' does not reference a valid ID column. Got '${
              column.references
            }', expected one of [${Object.keys(schema.tables)
              .map((t) => `'${t}.id'`)
              .join(", ")}].`,
          );
        }

        if (referencedTable[1].id.type !== column.type) {
          throw Error(
            `Validation failed: Foreign key column '${tableName}.${columnName}' type does not match the referenced table's ID column type. Got '${column.type}', expected '${referencedTable[1].id.type}'.`,
          );
        }

        // NOTE: This is unreachable, but worth documenting here.
        // if (column.list) {
        //   throw Error(
        //     `Validation failed: Foreign key column '${tableName}.${columnName}' cannot use the 'list' modifier.`,
        //   );
        // }
      }

      // NOTE: This is unreachable, but worth documenting here.
      // if (isPrimitiveColumn(column)) {
      //   if (
      //     column.type !== "bigint" &&
      //     column.type !== "string" &&
      //     column.type !== "boolean" &&
      //     column.type !== "int" &&
      //     column.type !== "float" &&
      //     column.type !== "hex"
      //   ) {
      //     throw Error(
      //       `Validation failed: Primitive column '${tableName}.${columnName}' type is invalid. Got '${column.type}', expected one of ['bigint', 'string', 'boolean', 'int', 'float', 'hex'].`,
      //     );
      //   }
      // }
    });
  });

  return { schema };
};

const validateTableOrColumnName = (key: string, type: string) => {
  if (key === "")
    throw Error(`Validation failed: ${type} name can't be an empty string.`);

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw Error(
      `Validation failed: ${type} name '${key}' contains an invalid character.`,
    );
};

export function safeBuildSchema({ schema }: { schema: Schema }) {
  try {
    const result = buildSchema({ schema });
    return { success: true, data: result } as const;
  } catch (error_) {
    const error = error_ as Error;
    error.stack = undefined;
    return { success: false, error } as const;
  }
}
