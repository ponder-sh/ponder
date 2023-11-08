import { Scalar, Schema } from "@/schema/types";
import { isEnumColumn, isVirtualColumn } from "@/schema/utils";

const scalarToTsType: Record<Scalar, string> = {
  string: "string",
  int: "number",
  float: "number",
  boolean: "boolean",
  bigint: "bigint",
  bytes: "`0x${string}`",
};

export const buildEntityTypes = (schema: Schema) => {
  // TODO:Kyle use recovered types inferred from the entity

  const entityModelTypes = Object.entries(schema.tables)
    .map(([tableName, table]) => {
      return `export type ${tableName} = {
        ${Object.entries(table)
          .map(([columnName, column]) => {
            // Build enum type as union

            if (isVirtualColumn(column)) return;
            else if (isEnumColumn(column)) {
              return `${columnName}${
                column.optional ? "?" : ""
              }: ${schema.enums[column.type]
                .map((val) => `"${val}"`)
                .join(" | ")};`;
            } else {
              // base column (reference or non reference)

              const scalar = scalarToTsType[column.type];

              return `${columnName}${column.optional ? "?" : ""}: ${scalar}${
                column.list ? "[]" : ""
              };`;
            }
          })
          .join("")}
        };`;
    })
    .join("");

  return entityModelTypes;
};
