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
      let idType = "string";

      const instanceType = `export type ${entity.name}Instance = {
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
                if (field.name === "id") idType = scalarTsType;

                return `${field.name}${
                  field.notNull ? "" : "?"
                }: ${scalarTsType};`;
              }
              case FieldKind.ENUM: {
                return `${field.name}${
                  field.notNull ? "" : "?"
                }: ${field.enumValues.map((val) => `"${val}"`).join(" | ")};`;
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
                  const enumValues = // @ts-ignore
                    (field.baseGqlType.astNode?.values || []).map(
                      // @ts-ignore
                      (v) => v.name.value
                    );
                  tsBaseType = `(${enumValues
                    // @ts-ignore
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
              case FieldKind.RELATIONSHIP: {
                return `${field.name}: string;`;
              }
            }
          })
          .join("")}
        };`;

      const modelType = `
        export type ${entity.name}Model = {
          get: (id: ${idType}) => Promise<${entity.name}Instance | null>;
          insert: (id: ${idType}, obj: Omit<${entity.name}Instance, "id">) => Promise<${entity.name}Instance>;
          update: (id: ${idType}, obj: Partial<Omit<${entity.name}Instance, "id">>) =>
            Promise<${entity.name}Instance>;
          delete: (id: ${idType}) => Promise<boolean>;
          upsert: (id: ${idType}, obj: Omit<${entity.name}Instance, "id">) => Promise<${entity.name}Instance>;
        };
      `;

      return instanceType + modelType;
    })
    .join("");

  return entityModelTypes;
};
