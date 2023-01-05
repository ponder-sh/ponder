/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  DirectiveNode,
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
  StringValueNode,
  TypeNode,
} from "graphql";

import {
  DerivedField,
  Entity,
  EnumField,
  Field,
  FieldKind,
  IDField,
  ListField,
  RelationshipField,
  ScalarField,
  Schema,
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
  Boolean: "integer",
  Int: "integer",
  String: "text",
  // graph-ts scalar types
  BigInt: "text",
  BigDecimal: "text",
  Bytes: "text",
};

export const buildSchema = (graphqlSchema: GraphQLSchema): Schema => {
  const gqlEntityTypes = getEntityTypes(graphqlSchema);
  const gqlEnumTypes = getEnumTypes(graphqlSchema);
  const gqlCustomScalarTypes = getCustomScalarTypes(graphqlSchema);

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
      const originalFieldType = field.type;

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

      const derivedFromDirective = field.directives?.find(
        (directive) => directive.name.value === "derivedFrom"
      );

      if (customScalarBaseType) {
        throw new Error(
          `Custom scalars are not supported: ${entityName}.${fieldName}`
        );
      }

      if (derivedFromDirective) {
        if (!entityBaseType || !isList) {
          throw new Error(
            `Resolved type of a @derivedFrom field must be a list of entities`
          );
        }
        return getDerivedField(
          fieldName,
          entityBaseType,
          originalFieldType,
          isNotNull,
          derivedFromDirective
        );
      }

      // Handle the ID field as a special case.
      if (fieldName === "id" && builtInScalarBaseType) {
        const baseType = builtInScalarBaseType;
        return getIdField(entityName, baseType, originalFieldType, isNotNull);
      }

      if (entityBaseType) {
        const baseType = entityBaseType;
        return getRelationshipField(
          fieldName,
          baseType,
          originalFieldType,
          isNotNull
        );
      }

      if (builtInScalarBaseType) {
        const baseType = builtInScalarBaseType;
        if (isList) {
          return getListField(
            fieldName,
            baseType,
            originalFieldType,
            isNotNull
          );
        } else {
          return getScalarField(
            fieldName,
            baseType,
            originalFieldType,
            isNotNull
          );
        }
      }

      // Handle enum types.
      if (enumBaseType) {
        const baseType = enumBaseType;
        if (isList) {
          return getListField(
            fieldName,
            baseType,
            originalFieldType,
            isNotNull
          );
        } else {
          return getEnumField(
            fieldName,
            baseType,
            originalFieldType,
            isNotNull
          );
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

  const schema: Schema = { entities, entityByName };

  return schema;
};

const getIdField = (
  entityName: string,
  baseType: GraphQLScalarType,
  originalFieldType: TypeNode,
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
    originalFieldType,
    notNull: true,
    migrateUpStatement: `"id" TEXT NOT NULL PRIMARY KEY`,
    sqlType: "string",
  };
};

const getScalarField = (
  fieldName: string,
  baseType: GraphQLScalarType,
  originalFieldType: TypeNode,
  isNotNull: boolean
) => {
  const sqlType = gqlScalarToSqlType[baseType.name];
  if (!sqlType) {
    throw new Error(`Unhandled scalar type: ${baseType.name}`);
  }

  let migrateUpStatement = `"${fieldName}" ${sqlType}`;
  if (isNotNull) {
    migrateUpStatement += " NOT NULL";
  }

  return <ScalarField>{
    name: fieldName,
    kind: FieldKind.SCALAR,
    baseGqlType: baseType,
    originalFieldType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType,
  };
};

const getEnumField = (
  fieldName: string,
  baseType: GraphQLEnumType,
  originalFieldType: TypeNode,
  isNotNull: boolean
) => {
  const enumValues = (baseType.astNode?.values || []).map((v) => v.name.value);

  let migrateUpStatement = `"${fieldName}" TEXT CHECK ("${fieldName}" IN (${enumValues
    .map((v) => `'${v}'`)
    .join(", ")}))`;

  if (isNotNull) {
    migrateUpStatement += " NOT NULL";
  }

  return <EnumField>{
    name: fieldName,
    kind: FieldKind.ENUM,
    baseGqlType: baseType,
    originalFieldType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType: "string",
    enumValues,
  };
};

const getListField = (
  fieldName: string,
  baseType: GraphQLEnumType | GraphQLScalarType,
  originalFieldType: TypeNode,
  isNotNull: boolean
) => {
  let migrateUpStatement = `"${fieldName}" TEXT`;
  if (isNotNull) {
    migrateUpStatement += " NOT NULL";
  }

  return <ListField>{
    name: fieldName,
    kind: FieldKind.LIST,
    baseGqlType: baseType,
    originalFieldType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType: "text", // JSON
  };
};

const getRelationshipField = (
  fieldName: string,
  baseType: GraphQLObjectType,
  originalFieldType: TypeNode,
  isNotNull: boolean
) => {
  let migrateUpStatement = `"${fieldName}" TEXT`;
  if (isNotNull) {
    migrateUpStatement += " NOT NULL";
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
    originalFieldType,
    notNull: isNotNull,
    migrateUpStatement,
    sqlType: "text", // foreign key
    relatedEntityName: baseType.name,
  };
};

const getDerivedField = (
  fieldName: string,
  baseType: GraphQLObjectType,
  originalFieldType: TypeNode,
  isNotNull: boolean,
  derivedFromDirective: DirectiveNode
) => {
  const derivedFromFieldArgument = derivedFromDirective.arguments?.find(
    (arg) => arg.name.value === "field" && arg.value.kind === "StringValue"
  );

  if (!derivedFromFieldArgument) {
    throw new Error(`The @derivedFrom requires a "field" argument`);
  }

  const derivedFromFieldName = (
    derivedFromFieldArgument.value as StringValueNode
  ).value;

  // See comment in getRelationshipField.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const baseTypeAsInputType = baseType as GraphQLInputObjectType;

  return <DerivedField>{
    name: fieldName,
    kind: FieldKind.DERIVED,
    baseGqlType: baseTypeAsInputType,
    originalFieldType,
    notNull: isNotNull,
    derivedFromEntityName: baseType.name,
    derivedFromFieldName: derivedFromFieldName,
  };
};
