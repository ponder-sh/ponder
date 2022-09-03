/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  FieldDefinitionNode,
  GraphQLEnumType,
  GraphQLSchema,
  Kind,
  NamedTypeNode,
} from "graphql";

import { getEntities, getUserDefinedTypes } from "@/gql";
import {
  Entity,
  EnumField,
  FieldKind,
  IDField,
  ListField,
  ScalarField,
  Schema,
} from "@/types";

const gqlScalarToSqlType: Record<string, string | undefined> = {
  ID: "text",
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
      const { fieldName, fieldType, isNotNull, isList } =
        unwrapFieldDefinition(field);

      // Handle the ID field as a special case.
      if (fieldName === "id") {
        return getIdField(
          fieldName,
          <NamedTypeNode>fieldType,
          isNotNull,
          entityName
        );
      }

      // Attempt to find a user-defined type with the same name as the unwrapped base type.
      const userDefinedBaseType = userDefinedGqlTypes[fieldType.name.value];

      const isBuiltInScalar = !userDefinedBaseType;
      // TODO: Actually support custom scalars lol
      const isCustomScalar = false;
      const isEnum =
        userDefinedBaseType?.astNode?.kind === Kind.ENUM_TYPE_DEFINITION;

      console.log({
        fieldName,
        fieldType,
        isNotNull,
        isList,
        isBuiltInScalar,
        isEnum,
      });

      if (isBuiltInScalar || isCustomScalar) {
        if (isList) {
          const tsBaseType = gqlScalarToTsType[fieldType.name.value]!;
          return getListField(fieldName, fieldType, isNotNull, tsBaseType);
        } else {
          return getScalarField(fieldName, fieldType, isNotNull);
        }
      }

      // Handle enum types.
      if (isEnum) {
        const enumValues = getEnumValues(<GraphQLEnumType>userDefinedBaseType);

        if (isList) {
          const tsBaseType = `(${enumValues.map((v) => `"${v}"`).join(" | ")})`;
          return getListField(fieldName, fieldType, isNotNull, tsBaseType);
        } else {
          return getEnumField(fieldName, fieldType, isNotNull, enumValues);
        }
      }

      // Handle base types that are NOT an entity (a list of scalars/enums).
      console.log("got to bottom with a userDefinedBaseType:", {
        userDefinedBaseType,
      });

      // // Handle list types where the base type is an entity (a relationship).
      // if (userDefinedBaseType.astNode?.kind === Kind.OBJECT_TYPE_DEFINITION) {
      //   // Handling list!
      //   throw new Error(`Unsupported GQL type: ${fieldType.name}`);
      // }

      throw new Error(`Unhandled field type: ${fieldType.name}`);
    });

    entities[entityName] = {
      name: entityName,
      fields: fieldInfo,
    };
  });

  const schema: Schema = { entities };

  console.log("returning schema: ", { entities: JSON.stringify(entities) });

  return schema;
};

const unwrapFieldDefinition = (field: FieldDefinitionNode) => {
  const fieldName = field.name.value;
  let fieldType = field.type;
  let nestedNonNullCount = 0;
  let nestedListCount = 0;

  while (fieldType.kind !== Kind.NAMED_TYPE) {
    // If a field is non-nullable, it's TypeNode will be wrapped with a NON_NULL_TYPE TypeNode.
    if (fieldType.kind === Kind.NON_NULL_TYPE) {
      nestedNonNullCount += 1;
      fieldType = fieldType.type;
    }

    // If a field is a list, it's TypeNode will be wrapped with a LIST_TYPE TypeNode.
    if (fieldType.kind === Kind.LIST_TYPE) {
      nestedListCount += 1;
      fieldType = fieldType.type;
    }
  }

  if (nestedListCount > 1) {
    throw new Error(`Nested lists are not currently supported.`);
  }

  return {
    fieldName,
    fieldType,
    isNotNull: nestedNonNullCount > 0,
    isList: nestedListCount > 0,
  };
};

const getIdField = (
  _fieldName: string,
  fieldType: NamedTypeNode,
  isNotNull: boolean,
  entityName: string
) => {
  const fieldTypeName = fieldType.name.value;

  if (!isNotNull) {
    throw new Error(`${entityName}.id field must be non-null`);
  }

  if (fieldTypeName !== "ID") {
    throw new Error(`${entityName}.id field must have type ID`);
  }

  return <IDField>{
    name: "id",
    kind: FieldKind.ID,
    notNull: true,
    gqlType: "ID",
    migrateUpStatement: `id text not null primary key`,
    sqlType: "string",
    tsType: "string",
  };
};

const getListField = (
  fieldName: string,
  fieldType: NamedTypeNode,
  isNotNull: boolean,
  tsBaseType: string
) => {
  const fieldTypeName = fieldType.name.value;

  let migrateUpStatement = `\`${fieldName}\` text`;
  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <ListField>{
    name: fieldName,
    kind: FieldKind.LIST,
    notNull: isNotNull,
    gqlType: fieldTypeName,
    migrateUpStatement,
    sqlType: "text", // JSON
    tsBaseType: tsBaseType,
  };
};

const getEnumValues = (type: GraphQLEnumType) => {
  if (!type.astNode?.values) {
    throw new Error(`Values not found for GQL Enum: ${type.name}`);
  }

  return type.astNode.values.map((v) => v.name.value);
};

const getEnumField = (
  fieldName: string,
  fieldType: NamedTypeNode,
  isNotNull: boolean,
  enumValues: string[]
) => {
  const fieldTypeName = fieldType.name.value;

  let migrateUpStatement = `\`${fieldName}\` text check (\`${fieldName}\` in (${enumValues
    .map((v) => `'${v}'`)
    .join(", ")}))`;

  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <EnumField>{
    name: fieldName,
    kind: FieldKind.ENUM,
    notNull: isNotNull,
    gqlType: fieldTypeName,
    migrateUpStatement,
    sqlType: "string",
    enumValues,
  };
};

const getScalarField = (
  fieldName: string,
  fieldType: NamedTypeNode,
  isNotNull: boolean
) => {
  const fieldTypeName = fieldType.name.value;

  const sqlType = gqlScalarToSqlType[fieldTypeName];
  const tsType = gqlScalarToTsType[fieldTypeName];
  if (!sqlType || !tsType) {
    throw new Error(`Unhandled scalar type: ${fieldTypeName}`);
  }

  let migrateUpStatement = `\`${fieldName}\` ${sqlType}`;
  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <ScalarField>{
    name: fieldName,
    kind: FieldKind.SCALAR,
    notNull: isNotNull,
    gqlType: fieldTypeName,
    migrateUpStatement,
    sqlType,
    tsType,
  };
};

export { buildSchema };
