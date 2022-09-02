/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { GraphQLSchema, Kind } from "graphql";

import { getEntities, getUserDefinedTypes } from "@/gql";
import {
  Entity,
  EnumField,
  FieldKind,
  IDField,
  ScalarField,
  Schema,
} from "@/types";

const gqlScalarToSqlType: Record<string, string | undefined> = {
  ID: "integer",
  Boolean: "boolean",
  Int: "integer",
  String: "text",
  // graph-ts scalar types
  BigInt: "text",
  BigDecimal: "text",
  Bytes: "text",
};

const gqlScalarToTsType: Record<string, string | undefined> = {
  ID: "string",
  Boolean: "boolean",
  Int: "number",
  String: "string",
  // graph-ts scalar types
  BigInt: "string",
  BigDecimal: "string",
  Bytes: "string",
};

const buildSchema = (userSchema: GraphQLSchema): Schema => {
  const userDefinedGqlTypes = getUserDefinedTypes(userSchema);
  const entityGqlTypes = getEntities(userSchema);

  const entities: Record<string, Entity> = {};

  entityGqlTypes.forEach((entity) => {
    const entityName = entity.name;
    const entityFields = entity.astNode?.fields || [];

    const fieldInfo = entityFields.map((field) => {
      let gqlType = field.type;
      let fieldNotNull = false;

      // If a field is non-nullable, it's TypeNode will be wrapped with another NON_NULL_TYPE TypeNode.
      if (gqlType.kind === Kind.NON_NULL_TYPE) {
        fieldNotNull = true;
        gqlType = gqlType.type;
      }

      if (gqlType.kind === Kind.LIST_TYPE) {
        throw new Error(`Unhandled TypeNode: ${Kind.LIST_TYPE}`);
      }

      const fieldName = field.name.value;
      const fieldGqlType = gqlType.name.value;

      // Handle the ID field.
      if (fieldGqlType === "ID") {
        if (
          !gqlScalarToSqlType[fieldGqlType] ||
          !gqlScalarToTsType[fieldGqlType]
        ) {
          throw new Error(`Unhandled ID type: ${fieldGqlType}`);
        }
        return <IDField>{
          name: fieldName,
          kind: FieldKind.ID,
          notNull: true,
          gqlType: fieldGqlType,
          migrateUpStatement: `id text not null primary key`,
          sqlType: gqlScalarToSqlType[fieldGqlType]!,
          tsType: gqlScalarToTsType[fieldGqlType]!,
        };
      }

      // Handle enums, lists, and relationships.
      const userDefinedType = userDefinedGqlTypes[fieldGqlType];
      if (userDefinedType) {
        // Handle enum types.
        if (userDefinedType.astNode?.kind == Kind.ENUM_TYPE_DEFINITION) {
          if (!userDefinedType.astNode.values) {
            throw new Error(`Values not found for GQL Enum: ${fieldName}`);
          }

          const enumValues = userDefinedType.astNode.values.map(
            (v) => v.name.value
          );

          let migrateUpStatement = `\`${fieldName}\` text check (\`${fieldName}\` in (${enumValues
            .map((v) => `'${v}'`)
            .join(", ")}))`;

          if (fieldNotNull) {
            migrateUpStatement += " not null";
          }

          return <EnumField>{
            name: fieldName,
            kind: FieldKind.ENUM,
            notNull: fieldNotNull,
            gqlType: fieldGqlType,
            migrateUpStatement,
            sqlType: "string",
            enumValues,
          };
        }

        // Handle list types.
        // else if (
        //   userDefinedType.astNode?.kind == Kind.LIST ?????
        // ) {
        //   // Handling list!
        //   throw new Error(`Unsupported GQL type: ${column.type}`);
        // }
      }

      // Handle scalars.
      if (
        !gqlScalarToSqlType[fieldGqlType] ||
        !gqlScalarToTsType[fieldGqlType]
      ) {
        throw new Error(`Unhandled ID type: ${fieldGqlType}`);
      }

      let migrateUpStatement = `\`${fieldName}\` ${gqlScalarToSqlType[fieldGqlType]}`;
      if (fieldNotNull) {
        migrateUpStatement += " not null";
      }

      return <ScalarField>{
        name: fieldName,
        kind: FieldKind.SCALAR,
        notNull: fieldNotNull,
        gqlType: fieldGqlType,
        migrateUpStatement,
        sqlType: gqlScalarToSqlType[fieldGqlType]!,
        tsType: gqlScalarToTsType[fieldGqlType]!,
      };
    });

    entities[entityName] = {
      name: entityName,
      fields: fieldInfo,
    };
  });

  const schema: Schema = { entities };

  return schema;
};

export { buildSchema };
