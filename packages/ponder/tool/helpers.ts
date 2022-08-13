import { GraphQLObjectType, GraphQLSchema, Kind } from "graphql";

// Find all types in the schema that are marked with the @entity directive.
const getEntities = (schema: GraphQLSchema) => {
  const entities = Object.values(schema.getTypeMap())
    .filter((type): type is GraphQLObjectType => {
      return type.astNode?.kind === Kind.OBJECT_TYPE_DEFINITION;
    })
    .filter((type) => {
      const entityDirective = type.astNode?.directives?.find(
        (directive) => directive.name.value === "entity"
      );

      return !!entityDirective;
    });

  return entities;
};

export { getEntities };
