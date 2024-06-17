import { BuildError } from "@/common/errors.js";
import type { Schema } from "@/schema/common.js";
import {
  extractReferenceTable,
  getEnums,
  getTables,
  isEnumColumn,
  isJSONColumn,
  isListColumn,
  isManyColumn,
  isOneColumn,
  isOptionalColumn,
  isReferenceColumn,
} from "@/schema/utils.js";
import { dedupe } from "@ponder/common";

export const buildSchema = ({ schema }: { schema: Schema }) => {
  const logs: { level: "warn" | "info" | "debug"; msg: string }[] = [];

  // Validate enums
  Object.entries(getEnums(schema)).forEach(([name, _enum]) => {
    validateTableOrColumnName(name, "Enum");

    const enumValues = new Set<string>();
    for (const enumValue of _enum) {
      if (enumValues.has(enumValue)) {
        throw new Error(
          `Validation failed: Enum '${name}' contains duplicate value '${enumValue}'.`,
        );
      }
      enumValues.add(enumValue);
    }
  });

  // Validate tables
  Object.entries(getTables(schema)).forEach(
    ([tableName, { table, constraints }]) => {
      validateTableOrColumnName(tableName, "Table");

      // Validate the id column
      if (table.id === undefined)
        throw new Error(
          `Validation failed: Table '${tableName}' does not have an 'id' column.`,
        );

      if (isJSONColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'json', expected one of ['string', 'hex', 'bigint', 'int'].`,
        );
      if (isEnumColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'enum', expected one of ['string', 'hex', 'bigint', 'int'].`,
        );
      if (isOneColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'one', expected one of ['string', 'hex', 'bigint', 'int'].`,
        );
      if (isManyColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. Got 'many', expected one of ['string', 'hex', 'bigint', 'int'].`,
        );
      if (isReferenceColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. ID columns cannot use the '.references' modifier.`,
        );

      if (
        table.id[" scalar"] !== "bigint" &&
        table.id[" scalar"] !== "string" &&
        table.id[" scalar"] !== "hex" &&
        table.id[" scalar"] !== "int"
      )
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. Got '${table.id[" scalar"]}', expected one of ['string', 'hex', 'bigint', 'int'].`,
        );

      if (isOptionalColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. ID columns cannot be optional.`,
        );
      if (isListColumn(table.id))
        throw new Error(
          `Validation failed: Invalid type for ID column '${tableName}.id'. ID columns cannot be a list.`,
        );

      // Validate all other columns
      Object.entries(table).forEach(([columnName, column]) => {
        if (columnName === "id") return;

        validateTableOrColumnName(columnName, "Column");

        if (isOneColumn(column)) {
          const usedColumn = Object.entries(table).find(
            ([c]) => c === column[" reference"],
          );

          if (usedColumn === undefined) {
            const otherColumns = Object.keys(table).filter(
              (c) => c !== columnName,
            );
            throw new Error(
              `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that does not exist. Got '${
                column[" reference"]
              }', expected one of [${otherColumns.map((c) => `'${c}'`).join(", ")}].`,
            );
          }

          if (!isReferenceColumn(usedColumn[1])) {
            const foreignKeyColumns = Object.keys(table).filter(
              (c) => c !== columnName && isReferenceColumn(table[c]!),
            );
            throw new Error(
              `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that is not foreign key column. Got '${
                column[" reference"]
              }', expected one of [${foreignKeyColumns.map((c) => `'${c}'`).join(", ")}].`,
            );
          }
        }

        if (isManyColumn(column)) {
          const usedTable = Object.entries(getTables(schema)).find(
            ([name]) => name === column[" referenceTable"],
          );

          if (usedTable === undefined) {
            const otherTables = Object.keys(getTables(schema)).filter(
              (t) => t !== tableName,
            );

            throw new Error(
              `Validation failed. Relationship column '${tableName}.${columnName}' uses a table that does not exist. Got '${
                column[" referenceTable"]
              }', expected one of [${otherTables.map((t) => `'${t}'`).join(", ")}].`,
            );
          }

          const usedTableColumns = Object.entries(usedTable[1].table);
          const usedColumn = usedTableColumns.find(
            ([columnName]) => columnName === column[" referenceColumn"],
          );

          if (usedColumn === undefined) {
            throw new Error(
              `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that does not exist. Got '${
                column[" referenceTable"]
              }.${column[" referenceTable"]}', expected one of [${usedTableColumns
                .map((c) => `'${usedTable[0]}.${c}'`)
                .join(", ")}].`,
            );
          }

          if (!isReferenceColumn(usedColumn[1])) {
            const foreignKeyColumnNames = usedTableColumns.filter(([, c]) =>
              isReferenceColumn(c),
            );
            throw new Error(
              `Validation failed. Relationship column '${tableName}.${columnName}' uses a column that is not foreign key column. Got '${
                column[" referenceTable"]
              }.${column[" referenceTable"]}', expected one of [${foreignKeyColumnNames
                .map((c) => `'${usedTable[0]}.${c}'`)
                .join(", ")}].`,
            );
          }
        }

        if (isEnumColumn(column)) {
          const referencedEnum = Object.entries(getEnums(schema)).find(
            ([enumName]) => enumName === column[" enum"],
          );
          if (referencedEnum === undefined) {
            throw new Error(
              `Validation failed: Enum column '${tableName}.${columnName}' doesn't reference a valid enum. Got '${
                column[" enum"]
              }', expected one of [${Object.keys(getEnums(schema))
                .map((e) => `'${e}'`)
                .join(", ")}].`,
            );
          }
        }

        if (isReferenceColumn(column)) {
          const referencedTable = Object.entries(getTables(schema)).find(
            ([tableName]) => tableName === extractReferenceTable(column),
          );

          if (referencedTable === undefined) {
            throw new Error(
              `Validation failed: Foreign key column '${tableName}.${columnName}' does not reference a valid ID column. Got '${extractReferenceTable(
                column,
              )}', expected one of [${Object.keys(getTables(schema))
                .map((t) => `'${t}.id'`)
                .join(", ")}].`,
            );
          }

          if (referencedTable[1].table.id[" scalar"] !== column[" scalar"]) {
            throw new Error(
              `Validation failed: Foreign key column '${tableName}.${columnName}' type does not match the referenced table's ID column type. Got '${column[" scalar"]}', expected '${referencedTable[1].table.id[" scalar"]}'.`,
            );
          }

          // NOTE: This is unreachable, but worth documenting here.
          // if (column.list) {
          //   throw new Error(
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
        //     throw new Error(
        //       `Validation failed: Primitive column '${tableName}.${columnName}' type is invalid. Got '${column.type}', expected one of ['bigint', 'string', 'boolean', 'int', 'float', 'hex'].`,
        //     );
        //   }
        // }
      });

      // Validate constraints
      if (constraints === undefined) return;

      for (const [name, index] of Object.entries(constraints)) {
        validateTableOrColumnName(name, "index");
        const column = index[" column"];

        if (Array.isArray(column)) {
          if (column.length === 0)
            throw new Error(
              `Validation failed: Index '${name}' cannot be empty.`,
            );

          if (column.length !== dedupe(column as string[]).length)
            throw new Error(
              `Validation failed: Index '${name}' cannot contain duplicate columns.`,
            );

          for (const c of column) {
            if (table[c] === undefined)
              throw new Error(
                `Validation failed: Index '${name}' does not reference a valid column. Got '${c}', expected one of [${Object.keys(
                  table,
                ).join(", ")}].`,
              );

            if (isJSONColumn(table[c]!))
              throw new Error(
                `Validation failed: Invalid type for column '${column}' referenced by index '${name}'. Got 'json', expected one of ['string', 'hex', 'bigint', 'int', 'boolean', 'float'].`,
              );

            if (isOneColumn(table[c]!))
              throw new Error(
                `Validation failed: Invalid type for column '${column}' referenced by index '${name}'. Got 'one', expected one of ['string', 'hex', 'bigint', 'int', 'boolean', 'float'].`,
              );

            if (isManyColumn(table[c]!))
              throw new Error(
                `Validation failed: Invalid type for column '${column}' referenced by index '${name}'. Got 'many', expected one of ['string', 'hex', 'bigint', 'int', 'boolean', 'float'].`,
              );
          }
        } else {
          if (column === "id") {
            logs.push({
              level: "warn",
              msg: `Ignoring index '${name}'. Column 'id' has a primary key constraint by default.`,
            });
            delete constraints[name];
            continue;
          }

          if (table[column] === undefined)
            throw new Error(
              `Validation failed: Index '${name}' does not reference a valid column. Got '${column}', expected one of [${Object.entries(
                table,
              )
                .filter(
                  ([_, column]) =>
                    !isOneColumn(column) && !isManyColumn(column),
                )
                .map(([columnName]) => columnName)
                .join(", ")}].`,
            );

          if (isJSONColumn(table[column]!))
            throw new Error(
              `Validation failed: Invalid type for column '${column}' referenced by index '${name}'. Got 'json', expected one of ['string', 'hex', 'bigint', 'int', 'boolean', 'float'].`,
            );

          if (isOneColumn(table[column]!))
            throw new Error(
              `Validation failed: Invalid type for column '${column}' referenced by index '${name}'. Got 'one', expected one of ['string', 'hex', 'bigint', 'int', 'boolean', 'float'].`,
            );

          if (isManyColumn(table[column]!))
            throw new Error(
              `Validation failed: Invalid type for column '${column}' referenced by index '${name}'. Got 'many', expected one of ['string', 'hex', 'bigint', 'int', 'boolean', 'float'].`,
            );
        }
      }
    },
  );

  return { schema, logs };
};

const validateTableOrColumnName = (key: string, type: string) => {
  if (key === "")
    throw new Error(
      `Validation failed: ${type} name can't be an empty string.`,
    );

  if (!/^[a-z|A-Z|0-9]+$/.test(key))
    throw new Error(
      `Validation failed: ${type} name '${key}' contains an invalid character.`,
    );
};

export function safeBuildSchema({ schema }: { schema: Schema }) {
  try {
    const result = buildSchema({ schema });
    return {
      status: "success",
      schema: result.schema,
      logs: result.logs,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
}
