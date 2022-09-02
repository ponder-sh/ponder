import {
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLSchema,
  Kind,
} from "graphql";

// Find all types in the schema that are marked with the @entity directive.
export const getEntities = (schema: GraphQLSchema) => {
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
  const userDefinedTypes: {
    [key: string]: GraphQLObjectType | GraphQLEnumType | undefined;
  } = {};
  for (const userDefinedType of userDefinedTypeArray) {
    userDefinedTypes[userDefinedType.name] = userDefinedType;
  }

  return userDefinedTypes;
};
