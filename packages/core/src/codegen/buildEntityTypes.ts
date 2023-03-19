/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Kind } from "graphql";

import { Entity, FieldKind } from "@/schema/types";

const gqlScalarToTsType: Record<string, string | undefined> = {
  String: "string",
  Boolean: "boolean",
  Int: "number",
  BigInt: "bigint",
  Bytes: "string",
};

export const buildEntityTypes = (entities: Entity[]) => {
  const entityModelTypes = entities
    .map((entity) => {
      return `
   export type ${entity.name}Instance = {
    ${entity.fields
      .map((field) => {
        switch (field.kind) {
          case FieldKind.SCALAR: {
            const scalarTsType = gqlScalarToTsType[field.scalarTypeName];
            if (!scalarTsType) {
              throw new Error(
                `TypeScript type not found for scalar: ${field.scalarTypeName}`
              );
            }

            return `${field.name}${field.notNull ? "" : "?"}: ${scalarTsType};`;
          }
          case FieldKind.ENUM: {
            return `${field.name}${field.notNull ? "" : "?"}: ${field.enumValues
              .map((val) => `"${val}"`)
              .join(" | ")};`;
          }
          case FieldKind.LIST: {
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
              // @ts-ignore
              field.baseGqlType.astNode?.kind === Kind.ENUM_TYPE_DEFINITION
            ) {
              // @ts-ignore
              const enumValues = (field.baseGqlType.astNode?.values || []).map(
                // @ts-ignore
                (v) => v.name.value
              );
              // @ts-ignore
              tsBaseType = `(${enumValues.map((v) => `"${v}"`).join(" | ")})`;
            } else {
              throw new Error(
                `Unable to generate type for field: ${field.name}`
              );
            }

            if (!field.isListElementNotNull) {
              tsBaseType = `(${tsBaseType} | null)`;
            }

            return `${field.name}${field.notNull ? "" : "?"}: ${tsBaseType}[];`;
          }
          case FieldKind.RELATIONSHIP: {
            return `${field.name}: string;`;
          }
        }
      })
      .join("")}
  };

  export type ${entity.name}Model = {
    get: (id: string) => Promise<${entity.name}Instance | null>;
    insert: (id: string, obj: Omit<${entity.name}Instance, "id">) => Promise<${
        entity.name
      }Instance>;
    update: (id: string, obj: Partial<Omit<${entity.name}Instance, "id">>) =>
      Promise<${entity.name}Instance>;
    delete: (id: string) => Promise<boolean>;
    upsert: (id: string, obj: Omit<${entity.name}Instance, "id">) => Promise<${
        entity.name
      }Instance>;
  };
    `;
    })
    .join("");

  return entityModelTypes;
};
