/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  DirectiveNode,
  FieldDefinitionNode,
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
  Kind,
  StringValueNode,
  TypeNode,
} from "graphql";
import { randomUUID } from "node:crypto";

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

  // The `id` field is used as a table name prefix in the EntityStore to avoid entity table name collisions.
  const instanceId = randomUUID();

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

      const {
        fieldName,
        fieldTypeName,
        isNotNull,
        isList,
        isListElementNotNull,
      } = unwrapFieldDefinition(field);

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
        if (isList) {
          throw new Error(
            `Invalid field: "${entityName}.${fieldName}". Lists of entities must use the @derivedFrom directive.`
          );
        }

        const baseType = entityBaseType;
        return getRelationshipField(
          fieldName,
          baseType,
          originalFieldType,
          isNotNull,
          instanceId
        );
      }

      if (builtInScalarBaseType) {
        const baseType = builtInScalarBaseType;
        if (isList) {
          return getListField(
            fieldName,
            baseType,
            originalFieldType,
            isNotNull,
            isListElementNotNull
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
            isNotNull,
            isListElementNotNull
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
      id: `${entityName}_${instanceId}`,
      name: entityName,
      gqlType: entity,
      isImmutable: entityIsImmutable,
      fields,
      fieldByName,
    };
  });

  const schema: Schema = {
    instanceId,
    entities,
  };

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

  if (
    baseType.name !== "ID" &&
    baseType.name !== "String" &&
    baseType.name !== "Bytes"
  ) {
    throw new Error(
      `${entityName}.id field must have type ID, String, or Bytes`
    );
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
  isNotNull: boolean,
  isListElementNotNull: boolean
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
    isListElementNotNull,
  };
};

const getRelationshipField = (
  fieldName: string,
  baseType: GraphQLObjectType,
  originalFieldType: TypeNode,
  isNotNull: boolean,
  instanceId: string
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
    relatedEntityId: `${baseType.name}_${instanceId}`,
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

// ------------------------------- UTILITIES -------------------------------- //

// Find the name and base type of a field definition,
//  and return the number of NON_NULL and/or LIST wrappers.
const unwrapFieldDefinition = (field: FieldDefinitionNode) => {
  const fieldName = field.name.value;
  let fieldType = field.type;
  let isNotNull = false;
  let isList = false;
  let isListElementNotNull = false;

  // First check if the field is non-null and unwrap it.
  if (fieldType.kind === Kind.NON_NULL_TYPE) {
    isNotNull = true;
    fieldType = fieldType.type;
  }

  // Then check if the field is a list and unwrap it.
  if (fieldType.kind === Kind.LIST_TYPE) {
    isList = true;
    fieldType = fieldType.type;

    // Now check if the list element type is non-null
    if (fieldType.kind === Kind.NON_NULL_TYPE) {
      isListElementNotNull = true;
      fieldType = fieldType.type;
    }
  }

  if (fieldType.kind === Kind.LIST_TYPE) {
    throw new Error(
      `Invalid field "${fieldName}": nested lists are not supported`
    );
  }

  return {
    fieldName,
    fieldTypeName: fieldType.name.value,
    isNotNull,
    isList,
    isListElementNotNull,
  };
};

// Find all types in the schema that are marked with the @entity directive.
const getEntityTypes = (schema: GraphQLSchema) => {
  const entities = Object.values(schema.getTypeMap())
    .filter((type): type is GraphQLObjectType => {
      return type.astNode?.kind === Kind.OBJECT_TYPE_DEFINITION;
    })
    .filter((type) => {
      return !!type.astNode?.directives?.find(
        (directive) => directive.name.value === "entity"
      );
    });

  return entities;
};

// Find all scalar types in the schema that were created by the user.
const getCustomScalarTypes = (schema: GraphQLSchema) => {
  return Object.values(schema.getTypeMap()).filter(
    (type) =>
      !!type.astNode &&
      type.astNode.kind === Kind.SCALAR_TYPE_DEFINITION &&
      !["BigInt", "BigDecimal", "Bytes"].includes(type.name)
  ) as GraphQLScalarType[];
};

// Find all types in the schema that were created by the user.
const getEnumTypes = (schema: GraphQLSchema) => {
  return Object.values(schema.getTypeMap()).filter(
    (type) => !!type.astNode && type.astNode.kind === Kind.ENUM_TYPE_DEFINITION
  ) as GraphQLEnumType[];
};
