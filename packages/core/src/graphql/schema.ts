import type { IndexingStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/types.js";
import {
  type GraphQLFieldConfig,
  GraphQLObjectType,
  GraphQLSchema,
} from "graphql";
import { type Context as HonoContext } from "hono";
import { buildEntityTypes } from "./entity.js";
import { buildEnumTypes } from "./enum.js";
import { buildEntityFilterTypes } from "./filter.js";
import type { GetLoader } from "./loader.js";
import { buildPluralField } from "./plural.js";
import { buildSingularField } from "./singular.js";

// TODO(kyle) stricter type
export type Parent = Record<string, any>;
export type Context = HonoContext<{
  Variables: { store: IndexingStore; getLoader: GetLoader };
}> & {
  get: {
    <key extends "store" | "getLoader">(_: key): key extends "store"
      ? IndexingStore
      : GetLoader;
  };
};

export const buildGraphqlSchema = (schema: Schema): GraphQLSchema => {
  const queryFields: Record<string, GraphQLFieldConfig<Parent, Context>> = {};

  const { enumTypes } = buildEnumTypes({ schema });
  const { entityFilterTypes } = buildEntityFilterTypes({ schema, enumTypes });
  const { entityTypes, entityPageTypes } = buildEntityTypes({
    schema,
    enumTypes,
    entityFilterTypes,
  });

  for (const [tableName, table] of Object.entries(schema.tables)) {
    const entityType = entityTypes[tableName];
    const entityPageType = entityPageTypes[tableName];
    const entityFilterType = entityFilterTypes[tableName];

    const singularFieldName =
      tableName.charAt(0).toLowerCase() + tableName.slice(1);
    queryFields[singularFieldName] = buildSingularField({
      tableName,
      table,
      entityType,
    });

    const pluralFieldName = `${singularFieldName}s`;
    queryFields[pluralFieldName] = buildPluralField({
      tableName,
      entityPageType,
      entityFilterType,
    });
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: queryFields,
    }),
  });
};
