import {
  GraphQLFieldConfig,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";

import { Schema } from "@/schema/types";
import { UserStore } from "@/user-store/store";

import { buildEntityType } from "./buildEntityType";
import { buildPluralField } from "./buildPluralField";
import { buildSingularField } from "./buildSingularField";

export type Source = { request: unknown };
export type Context = { store: UserStore };

const buildGqlSchema = (schema: Schema) => {
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

  const metaGqlType = new GraphQLObjectType({
    name: "_Meta_",
    fields: {
      // Note that this is nullable.
      entityStoreVersionId: {
        type: GraphQLString,
        description:
          "The entity store version ID. Tables in the store use the naming scheme {entityName}_{versionId}. The version ID changes on every hot reload and redeployment.",
      },
    },
  });

  queryFields["_meta"] = {
    type: new GraphQLNonNull(metaGqlType),
    resolve: (_, __, context) => ({
      entityStoreVersionId: context.store.versionId,
    }),
  };

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
