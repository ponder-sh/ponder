import { isEnumType, isVirtual } from "@/schema/schema";
import { Scalar, Schema } from "@/schema/types";

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

            if (isVirtual(column)) return;
            if (isEnumType(column.type)) {
              return `${columnName}${
                column.optional ? "?" : ""
              }: ${schema.enums[column.type.slice(5)]
                .map((val) => `"${val}"`)
                .join(" | ")};`;
            }

            const scalar = scalarToTsType[column.type];

            return `${columnName}${column.optional ? "?" : ""}: ${scalar}${
              column.list ? "[]" : ""
            };`;
          })
          .join("")}
        };`;
    })
    .join("");

  return entityModelTypes;
};
