import { GraphQLFieldConfig, GraphQLObjectType, GraphQLSchema } from "graphql";

import type { PonderSchema } from "@/schema/types";
import type { EntityStore } from "@/store/entityStore";

import { buildEntityType } from "./buildEntityType";
import { buildPluralField } from "./buildPluralField";
import { buildSingularField } from "./buildSingularField";

export type Source = { request: unknown };
export type Context = { store: EntityStore };

const buildGqlSchema = (schema: PonderSchema): GraphQLSchema => {
  const queryFields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  const entityTypes: Record<string, GraphQLObjectType<Source, Context>> = {};

  // First build the entity types. These have resolvers defined for any
  // relationship or derived fields. This is also important for the thunk nonsense.
  for (const entity of schema.entities) {
    entityTypes[entity.name] = buildEntityType(entity, entityTypes);
  }

  for (const entity of schema.entities) {
    const entityGqlType = entityTypes[entity.name];

    const singularFieldName =
      entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
    queryFields[singularFieldName] = buildSingularField(entity, entityGqlType);

    const pluralFieldName = singularFieldName + "s";
    queryFields[pluralFieldName] = buildPluralField(entity, entityGqlType);
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: queryFields,
  });

  const gqlSchema = new GraphQLSchema({
    query: queryType,
  });

  return gqlSchema;
};

export { buildGqlSchema };
