/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { GraphQLEnumType, GraphQLSchema, Kind, NamedTypeNode } from "graphql";

import {
  Entity,
  EnumField,
  Field,
  FieldKind,
  IDField,
  ListField,
  PonderSchema,
  RelationshipField,
  ScalarField,
} from "./types";
import {
  getEntityTypes,
  getUserDefinedTypes,
  unwrapFieldDefinition,
} from "./utils";

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

export const buildPonderSchema = (userSchema: GraphQLSchema): PonderSchema => {
  const userDefinedGqlTypes = getUserDefinedTypes(userSchema);
  const gqlEntities = getEntityTypes(userSchema);

  const entities = gqlEntities.map((entity) => {
    const entityName = entity.name;
    const entityIsImmutable = !!entity.astNode?.directives
      ?.find((directive) => directive.name.value === "entity")
      ?.arguments?.find(
        (arg) =>
          arg.name.value === "immutable" &&
          arg.value.kind === "BooleanValue" &&
          arg.value.value
      );

    const gqlFields = entity.astNode?.fields || [];

    const fields = gqlFields.map((field) => {
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
      const isCustomScalar = false; // TODO: Actually support custom scalars lol
      const isEnum =
        userDefinedBaseType?.astNode?.kind === Kind.ENUM_TYPE_DEFINITION;

      const isEntity = gqlEntities
        .map((e) => e.name)
        .includes(fieldType.name.value);

      // const isDerivedFrom = !!field.directives?.find(
      //   (directive) => directive.name.value === "derivedFrom"
      // );

      if (isEntity) {
        return getRelationshipField(fieldName, fieldType, isNotNull);
      }

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

      throw new Error(`Unhandled field type: ${fieldType.name.value}`);
    });

    const fieldByName: Record<string, Field> = {};
    fields.forEach((field) => {
      fieldByName[field.name] = field;
    });

    return {
      name: entityName,
      isImmutable: entityIsImmutable,
      fields,
      fieldByName,
    };
  });

  const entityByName: Record<string, Entity> = {};
  entities.forEach((entity) => {
    entityByName[entity.name] = entity;
  });

  const schema: PonderSchema = { entities, entityByName };

  return schema;
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

const getRelationshipField = (
  fieldName: string,
  fieldType: NamedTypeNode,
  isNotNull: boolean
) => {
  const fieldTypeName = fieldType.name.value;

  let migrateUpStatement = `\`${fieldName}\` text`;
  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <RelationshipField>{
    name: fieldName,
    kind: FieldKind.RELATIONSHIP,
    notNull: isNotNull,
    gqlType: fieldTypeName,
    migrateUpStatement,
    sqlType: "text", // foreign key
    tsType: "string",
    relatedEntityName: fieldTypeName,
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
