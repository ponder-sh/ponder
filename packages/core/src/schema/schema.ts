import {
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
} from "graphql";

import {
  DerivedField,
  Entity,
  EnumField,
  Field,
  ListField,
  RelationshipField,
  ScalarField,
  Schema,
} from "./types";

const GraphQLBigInt = new GraphQLScalarType({
  name: "BigInt",
  serialize: (value) => String(value),
  parseValue: (value) => BigInt(value),
  parseLiteral: (value) => {
    if (value.kind === "StringValue") {
      return BigInt(value.value);
    } else {
      throw new Error(
        `Invalid value kind provided for field of type BigInt: ${value.kind}. Expected: StringValue`
      );
    }
  },
});

const gqlScalarTypeByName: Record<string, GraphQLScalarType | undefined> = {
  ID: GraphQLID,
  Int: GraphQLInt,
  Float: GraphQLFloat,
  String: GraphQLString,
  Boolean: GraphQLBoolean,
  BigInt: GraphQLBigInt,
  Bytes: GraphQLString,
};

export const buildSchema = (graphqlSchema: GraphQLSchema): Schema => {
  const gqlEntityTypes = getEntityTypes(graphqlSchema);
  const gqlEnumTypes = getEnumTypes(graphqlSchema);

  const userDefinedScalars = getUserDefinedScalarTypes(graphqlSchema);
  if (userDefinedScalars.length > 0) {
    throw new Error(
      `Custom scalars are not supported: ${userDefinedScalars[0]}`
    );
  }

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

      // Try to find a type that matches the base type of this field.
      const scalarBaseType = gqlScalarTypeByName[fieldTypeName];
      const enumBaseType = gqlEnumTypes.find((t) => t.name === fieldTypeName);
      const entityBaseType = gqlEntityTypes.find(
        (t) => t.name === fieldTypeName
      );

      const derivedFromDirective = field.directives?.find(
        (directive) => directive.name.value === "derivedFrom"
      );

      // Handle derived fields.
      if (derivedFromDirective) {
        if (!entityBaseType || !isList) {
          throw new Error(
            `Resolved type of a @derivedFrom field must be a list of entities`
          );
        }

        const derivedFromFieldArgument = derivedFromDirective.arguments?.find(
          (arg) =>
            arg.name.value === "field" && arg.value.kind === "StringValue"
        );
        if (!derivedFromFieldArgument) {
          throw new Error(
            `The @derivedFrom directive requires an argument: field`
          );
        }

        const derivedFromFieldName = (
          derivedFromFieldArgument.value as StringValueNode
        ).value;

        const baseTypeAsInputType =
          entityBaseType as unknown as GraphQLInputObjectType;

        return <DerivedField>{
          name: fieldName,
          kind: "DERIVED",
          baseGqlType: baseTypeAsInputType,
          originalFieldType,
          notNull: isNotNull,
          derivedFromEntityName: entityBaseType.name,
          derivedFromFieldName: derivedFromFieldName,
        };
      }

      // Handle relationship types.
      if (entityBaseType) {
        if (isList) {
          throw new Error(
            `Invalid field: ${entityName}.${fieldName}. Lists of entities must use the @derivedFrom directive.`
          );
        }

        const relatedEntityIdField = entityBaseType.getFields()["id"]?.astNode;
        if (!relatedEntityIdField) {
          throw new Error(
            `Related entity is missing an id field: ${entityBaseType.name}`
          );
        }

        const { fieldTypeName } = unwrapFieldDefinition(relatedEntityIdField);
        const relatedEntityIdType = gqlScalarTypeByName[fieldTypeName];
        if (!relatedEntityIdType) {
          throw new Error(
            `Related entity id field is not a scalar: ${entityBaseType.name}`
          );
        }

        // Everything downstream requires the base type as a GraphQLInputObject type, but idk how to safely convert it.
        // AFAICT, the GraphQLObjectType is a strict superset of GraphQLInputObject, so this should be fine.
        const entityBaseTypeAsInputType =
          entityBaseType as unknown as GraphQLInputObjectType;

        return <RelationshipField>{
          name: fieldName,
          kind: "RELATIONSHIP",
          baseGqlType: entityBaseTypeAsInputType,
          originalFieldType,
          notNull: isNotNull,
          relatedEntityName: entityBaseType.name,
          relatedEntityIdType: relatedEntityIdType,
        };
      }

      // Handle list types.
      if (isList) {
        if (scalarBaseType) {
          return <ListField>{
            name: fieldName,
            kind: "LIST",
            baseGqlType: scalarBaseType,
            originalFieldType,
            notNull: isNotNull,
            isListElementNotNull,
          };
        }

        if (enumBaseType) {
          return <ListField>{
            name: fieldName,
            kind: "LIST",
            baseGqlType: enumBaseType,
            originalFieldType,
            notNull: isNotNull,
            isListElementNotNull,
          };
        }
      }

      // Handle scalar types.
      if (scalarBaseType) {
        const baseType = scalarBaseType;

        // Validate the id field.
        if (fieldName === "id") {
          if (!isNotNull) {
            throw new Error(`${entityName}.id field must be non-null`);
          }
          if (isList) {
            throw new Error(`${entityName}.id field must not be a list`);
          }
          if (!["BigInt", "String", "Int", "Bytes"].includes(baseType.name)) {
            throw new Error(
              `${entityName}.id field must be a String, BigInt, Int, or Bytes.`
            );
          }
        }

        return <ScalarField>{
          name: fieldName,
          kind: "SCALAR",
          notNull: isNotNull,
          originalFieldType,
          scalarTypeName: fieldTypeName,
          scalarGqlType: baseType,
        };
      }

      // Handle enum types.
      if (enumBaseType) {
        const enumValues = (enumBaseType.astNode?.values || []).map(
          (v) => v.name.value
        );
        return <EnumField>{
          name: fieldName,
          kind: "ENUM",
          enumGqlType: enumBaseType,
          originalFieldType,
          notNull: isNotNull,
          enumValues,
        };
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

  const schema: Schema = {
    entities,
  };

  return schema;
};

// ------------------------------- UTILITIES -------------------------------- //

// Find the name and base type of a field definition,
// handling any wrapper types (NON_NULL_TYPE and LIST_TYPE).
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
const getUserDefinedScalarTypes = (schema: GraphQLSchema) => {
  return Object.values(schema.getTypeMap()).filter(
    (type) =>
      !!type.astNode &&
      type.astNode.kind === Kind.SCALAR_TYPE_DEFINITION &&
      !["BigInt", "Bytes"].includes(type.name)
  ) as GraphQLScalarType[];
};

// Find all types in the schema that were created by the user.
const getEnumTypes = (schema: GraphQLSchema) => {
  return Object.values(schema.getTypeMap()).filter(
    (type) => !!type.astNode && type.astNode.kind === Kind.ENUM_TYPE_DEFINITION
  ) as GraphQLEnumType[];
};
