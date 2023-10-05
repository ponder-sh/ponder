import { Entity, Scalar } from "@/schema/ts-types";

const scalarToTsType: Record<
  "string" | "number" | "boolean" | "bytes" | "bigint",
  string
> = {
  string: "string",
  number: "number",
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
        ${Object.keys(entity.columns)
          .map((key) => {
            const scalar = scalarToTsType[entity.columns[key].type as Scalar];

            return `${key}${
              entity.columns[key].optional === true ? "?" : ""
            }: ${scalar}${entity.columns[key].list === true ? "[]" : ""};`;
          })
          .join("")}
        };`;
    })
    .join("");

  return entityModelTypes;
};
