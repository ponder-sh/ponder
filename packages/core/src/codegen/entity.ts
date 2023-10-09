import { Entity, Scalar } from "@/schema/types";

const scalarToTsType: Record<Scalar, string> = {
  string: "string",
  int: "number",
  float: "number",
  boolean: "boolean",
  bigint: "bigint",
  bytes: "0x{string}", // TODO: Not sure about this
};

export const buildEntityTypes = (entities: readonly Entity[]) => {
  // const entityModelTypes = entities
  // .map((entity, i) => {
  //   return `export type ${entity.name} = RecoverTableType<((typeof schema)[${i}][${entity.name}])["table"]>`;
  // })
  // .join("");
  const entityModelTypes = entities
    .map((entity) => {
      return `export type ${entity.name} = {
        ${Object.entries(entity.columns)
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
