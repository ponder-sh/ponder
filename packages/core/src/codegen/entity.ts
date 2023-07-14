import { Kind } from "graphql";

import type { Entity } from "@/schema/types";

const gqlScalarToTsType: Record<string, string | undefined> = {
  String: "string",
  Boolean: "boolean",
  Int: "number",
  Float: "number",
  BigInt: "bigint",
  Bytes: "string",
};

export const buildEntityTypes = (entities: Entity[]) => {
  const entityModelTypes = entities
    .map((entity) => {
      return `export type ${entity.name} = {
        ${entity.fields
          .map((field) => {
            switch (field.kind) {
              case "SCALAR": {
                const scalarTsType = gqlScalarToTsType[field.scalarTypeName];
                if (!scalarTsType) {
                  throw new Error(
                    `TypeScript type not found for scalar: ${field.scalarTypeName}`
                  );
                }
                return `${field.name}${
                  field.notNull ? "" : "?"
                }: ${scalarTsType};`;
              }
              case "ENUM": {
                return `${field.name}${
                  field.notNull ? "" : "?"
                }: ${field.enumValues.map((val) => `"${val}"`).join(" | ")};`;
              }
              case "LIST": {
                // This is trash
                let tsBaseType: string;
                if (
                  Object.keys(gqlScalarToTsType).includes(
                    field.baseGqlType.toString()
                  )
                ) {
                  const scalarTypeName = field.baseGqlType.toString();
                  const scalarTsType = gqlScalarToTsType[scalarTypeName];
                  if (!scalarTsType) {
                    throw new Error(
                      `TypeScript type not found for scalar: ${scalarTypeName}`
                    );
                  }
                  tsBaseType = scalarTsType;
                } else if (
                  field.baseGqlType.astNode?.kind === Kind.ENUM_TYPE_DEFINITION
                ) {
                  const enumValues = (
                    field.baseGqlType.astNode?.values || []
                  ).map((v) => v.name.value);
                  tsBaseType = `(${enumValues
                    .map((v) => `"${v}"`)
                    .join(" | ")})`;
                } else {
                  throw new Error(
                    `Unable to generate type for field: ${field.name}`
                  );
                }

                if (!field.isListElementNotNull) {
                  tsBaseType = `(${tsBaseType} | null)`;
                }

                return `${field.name}${
                  field.notNull ? "" : "?"
                }: ${tsBaseType}[];`;
              }
              case "RELATIONSHIP": {
                const relatedEntityIdTsType =
                  gqlScalarToTsType[field.relatedEntityIdType.name];
                if (!relatedEntityIdTsType) {
                  throw new Error(
                    `TypeScript type not found for related entity ID type: ${field.relatedEntityIdType.name}`
                  );
                }

                return `${field.name}${
                  field.notNull ? "" : "?"
                }: ${relatedEntityIdTsType};`;
              }
            }
          })
          .join("")}
        };`;
    })
    .join("");

  return entityModelTypes;
};
