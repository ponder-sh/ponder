/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";

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
  getCustomScalarTypes,
  getEntityTypes,
  getEnumTypes,
  unwrapFieldDefinition,
} from "./utils";

const gqlScalarTypeByName: Record<string, GraphQLScalarType | undefined> = {
  ID: GraphQLID,
  Int: GraphQLInt,
  Float: GraphQLFloat,
  String: GraphQLString,
  Boolean: GraphQLBoolean,
  // Graph Protocol custom scalars
  BigInt: GraphQLString,
  Bytes: GraphQLString,
  BigDecimal: GraphQLString,
};

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

export const buildPonderSchema = (userSchema: GraphQLSchema): PonderSchema => {
  const gqlEntityTypes = getEntityTypes(userSchema);
  const gqlEnumTypes = getEnumTypes(userSchema);
  const gqlCustomScalarTypes = getCustomScalarTypes(userSchema);

  const entities = gqlEntityTypes.map((entity) => {
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
      const { fieldName, fieldTypeName, isNotNull, isList } =
        unwrapFieldDefinition(field);

      // Try to find a GQL type that matches the base type of this field.
      const builtInScalarBaseType = gqlScalarTypeByName[fieldTypeName];
      const customScalarBaseType = gqlCustomScalarTypes.find(
        (t) => t.name === fieldTypeName
      );
      const enumBaseType = gqlEnumTypes.find((t) => t.name === fieldTypeName);
      const entityBaseType = gqlEntityTypes.find(
        (t) => t.name === fieldTypeName
      );

      // const isDerivedFrom = !!field.directives?.find(
      //   (directive) => directive.name.value === "derivedFrom"
      // );

      if (customScalarBaseType) {
        throw new Error(
          `Custom scalars are not supported: ${entityName}.${fieldName}`
        );
      }

      // Handle the ID field as a special case.
      if (fieldName === "id" && builtInScalarBaseType) {
        const baseType = builtInScalarBaseType;
        return getIdField(entityName, baseType, isNotNull);
      }

      if (entityBaseType) {
        const baseType = entityBaseType;
        return getRelationshipField(fieldName, baseType, isNotNull);
      }

      if (builtInScalarBaseType) {
        const baseType = builtInScalarBaseType;
        if (isList) {
          return getListField(fieldName, baseType, isNotNull);
        } else {
          return getScalarField(fieldName, baseType, isNotNull);
        }
      }

      // Handle enum types.
      if (enumBaseType) {
        const baseType = enumBaseType;
        if (isList) {
          return getListField(fieldName, baseType, isNotNull);
        } else {
          return getEnumField(fieldName, baseType, isNotNull);
        }
      }

      throw new Error(`Unhandled field type: ${fieldTypeName}`);
    });

    const fieldByName: Record<string, Field> = {};
    fields.forEach((field) => {
      fieldByName[field.name] = field;
    });

    return <Entity>{
      name: entityName,
      gqlType: entity,
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
  entityName: string,
  baseType: GraphQLScalarType,
  isNotNull: boolean
) => {
  if (!isNotNull) {
    throw new Error(`${entityName}.id field must be non-null`);
  }

  if (baseType.name !== "ID") {
    throw new Error(`${entityName}.id field must have type ID`);
  }

  return <IDField>{
    name: "id",
    kind: FieldKind.ID,
    baseGqlType: baseType,
    notNull: true,
    migrateUpStatement: `id text not null primary key`,
    sqlType: "string",
  };
};

const getRelationshipField = (
  fieldName: string,
  baseType: GraphQLObjectType,
  isNotNull: boolean
) => {
  let migrateUpStatement = `\`${fieldName}\` text`;
  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  // Everything downstream requires the base type as a GraphQLInputObject type, but idk how to safely convert it.
  // AFAICT, the GraphQLObjectType is a strict superset of GraphQLInputObject, so this should be fine.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const baseTypeAsInputType = baseType as GraphQLInputObjectType;

  return <RelationshipField>{
    name: fieldName,
    kind: FieldKind.RELATIONSHIP,
    baseGqlType: baseTypeAsInputType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType: "text", // foreign key
    relatedEntityName: baseType.name,
  };
};

const getListField = (
  fieldName: string,
  baseType: GraphQLEnumType | GraphQLScalarType,
  isNotNull: boolean
) => {
  let migrateUpStatement = `\`${fieldName}\` text`;
  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <ListField>{
    name: fieldName,
    kind: FieldKind.LIST,
    baseGqlType: baseType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType: "text", // JSON
  };
};

const getEnumField = (
  fieldName: string,
  baseType: GraphQLEnumType,
  isNotNull: boolean
) => {
  const enumValues = (baseType.astNode?.values || []).map((v) => v.name.value);

  let migrateUpStatement = `\`${fieldName}\` text check (\`${fieldName}\` in (${enumValues
    .map((v) => `'${v}'`)
    .join(", ")}))`;

  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <EnumField>{
    name: fieldName,
    kind: FieldKind.ENUM,
    baseGqlType: baseType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType: "string",
    enumValues,
  };
};

const getScalarField = (
  fieldName: string,
  baseType: GraphQLScalarType,
  isNotNull: boolean
) => {
  const sqlType = gqlScalarToSqlType[baseType.name];
  if (!sqlType) {
    throw new Error(`Unhandled scalar type: ${baseType.name}`);
  }

  let migrateUpStatement = `\`${fieldName}\` ${sqlType}`;
  if (isNotNull) {
    migrateUpStatement += " not null";
  }

  return <ScalarField>{
    name: fieldName,
    kind: FieldKind.SCALAR,
    baseGqlType: baseType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType,
  };
};
