import {
  FieldDefinitionNode,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  Kind,
} from "graphql";

// Find the name and base type of a field definition,
//  and return the number of NON_NULL and/or LIST wrappers.
export const unwrapFieldDefinition = (field: FieldDefinitionNode) => {
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
export const getEntityTypes = (schema: GraphQLSchema) => {
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
export const getCustomScalarTypes = (schema: GraphQLSchema) => {
  return Object.values(schema.getTypeMap()).filter(
    (type) =>
      !!type.astNode &&
      type.astNode.kind === Kind.SCALAR_TYPE_DEFINITION &&
      !["BigInt", "BigDecimal", "Bytes"].includes(type.name)
  ) as GraphQLScalarType[];
};

// Find all types in the schema that were created by the user.
export const getEnumTypes = (schema: GraphQLSchema) => {
  return Object.values(schema.getTypeMap()).filter(
    (type) => !!type.astNode && type.astNode.kind === Kind.ENUM_TYPE_DEFINITION
  ) as GraphQLEnumType[];
};
