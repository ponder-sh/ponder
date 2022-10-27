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
    fieldTypeName: fieldType.name.value,
    isNotNull: nestedNonNullCount > 0,
    isList: nestedListCount > 0,
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
