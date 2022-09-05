import { GraphQLFieldConfig, GraphQLObjectType, GraphQLSchema } from "graphql";

import { getEntityTypes, getUserDefinedTypes } from "@/core/schema/utils";
import { SqliteStore } from "@/stores/sqlite";

import { buildPluralField } from "./buildPluralField";
import { buildSingularField } from "./buildSingularField";

export type Source = { request: unknown };
export type Context = { store: SqliteStore };

const buildGqlSchema = (userSchema: GraphQLSchema): GraphQLSchema => {
  const userDefinedTypes = getUserDefinedTypes(userSchema);
  const entityTypes = getEntityTypes(userSchema);

  const fields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  for (const entityType of entityTypes) {
    const singularFieldName =
      entityType.name.charAt(0).toLowerCase() + entityType.name.slice(1);
    fields[singularFieldName] = buildSingularField(entityType);

    const pluralFieldName = singularFieldName + "s";
    fields[pluralFieldName] = buildPluralField(
      entityType,
      userDefinedTypes,
      entityTypes
    );
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: fields,
  });

  const schema = new GraphQLSchema({ query: queryType });

  return schema;
};

export { buildGqlSchema };
