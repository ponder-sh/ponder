import type { Database } from "better-sqlite3";
import { GraphQLFieldConfig, GraphQLObjectType, GraphQLSchema } from "graphql";

import { getEntityTypes, getUserDefinedTypes } from "@/core/schema/utils";

import { buildPluralField } from "./buildPluralField";
import { buildSingularField } from "./buildSingularField";

export type Source = { request: unknown };
export type Context = { db: Database };

const buildGqlSchema = (userSchema: GraphQLSchema): GraphQLSchema => {
  const userDefinedTypes = getUserDefinedTypes(userSchema);
  const entityTypes = getEntityTypes(userSchema);

  const fields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  for (const entityType of entityTypes) {
    const singularFieldName =
      entityType.name.charAt(0).toLowerCase() + entityType.name.slice(1);
    fields[singularFieldName] = buildSingularField(entityType);

    const pluralFieldName = singularFieldName + "s";
    fields[pluralFieldName] = buildPluralField(entityType, userDefinedTypes);
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: fields,
  });

  const schema = new GraphQLSchema({ query: queryType });

  return schema;
};

export { buildGqlSchema };
