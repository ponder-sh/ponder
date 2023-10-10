import { Scalar, Schema } from "@/schema/types";

const scalarToTsType: Record<Scalar, string> = {
  string: "string",
  int: "number",
  float: "number",
  boolean: "boolean",
  bigint: "bigint",
  bytes: "0x{string}",
};

export const buildEntityTypes = (schema: Schema) => {
  // TODO:Kyle use recovered types inferred from the entity

  const entityModelTypes = Object.entries(schema)
    .map(([tableName, table]) => {
      return `export type ${tableName} = {
        ${Object.entries(table)
          .map(([columnName, column]) => {
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
