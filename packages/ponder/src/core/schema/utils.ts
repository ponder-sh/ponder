import {
  FieldDefinitionNode,
  GraphQLEnumType,
  GraphQLObjectType,
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
    fieldType,
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

// Find all types in the schema that were created by the user.
export const getUserDefinedTypes = (schema: GraphQLSchema) => {
  // This assumes that any type that has an AST node that is NOT
  // a scalar type definition will be a user-defined type.
  const userDefinedTypeArray = Object.values(schema.getTypeMap()).filter(
    (type): type is GraphQLObjectType | GraphQLEnumType =>
      !!type.astNode && type.astNode.kind !== Kind.SCALAR_TYPE_DEFINITION
  );

  // Add all user-defined types to a map so we can look them up later.
  const userDefinedTypes: Record<
    string,
    GraphQLObjectType | GraphQLEnumType | undefined
  > = {};
  for (const userDefinedType of userDefinedTypeArray) {
    userDefinedTypes[userDefinedType.name] = userDefinedType;
  }

  return userDefinedTypes;
};
