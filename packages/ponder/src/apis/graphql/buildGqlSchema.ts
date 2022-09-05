import { GraphQLFieldConfig, GraphQLObjectType, GraphQLSchema } from "graphql";

import { PonderSchema } from "@/core/schema/types";
import { SqliteStore } from "@/stores/sqlite";

import { buildPluralField } from "./buildPluralField";
import { buildSingularField } from "./buildSingularField";

export type Source = { request: unknown };
export type Context = { store: SqliteStore };

const buildGqlSchema = (schema: PonderSchema): GraphQLSchema => {
  const fields: Record<string, GraphQLFieldConfig<Source, Context>> = {};

  for (const entity of schema.entities) {
    const singularFieldName =
      entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
    fields[singularFieldName] = buildSingularField(entity);

    const pluralFieldName = singularFieldName + "s";
    fields[pluralFieldName] = buildPluralField(entity);
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: fields,
  });

  const gqlSchema = new GraphQLSchema({ query: queryType });

  return gqlSchema;
};

export { buildGqlSchema };
