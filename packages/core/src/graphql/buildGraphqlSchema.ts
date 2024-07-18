import type { MetadataStore, ReadonlyStore } from "@/indexing-store/store.js";
import type { Schema } from "@/schema/common.js";
import { getTables } from "@/schema/utils.js";
import {
  type GraphQLFieldConfig,
  GraphQLObjectType,
  GraphQLSchema,
} from "graphql";
import type { GetLoader } from "./buildLoaderCache.js";
import { buildEntityTypes } from "./entity.js";
import { buildEnumTypes } from "./enum.js";
import { buildEntityFilterTypes } from "./filter.js";
import { metadataEntity } from "./metadata.js";
import { buildPluralField } from "./plural.js";
import { buildSingularField } from "./singular.js";

// TODO(kyle) stricter type
export type Parent = Record<string, any>;
export type Context = {
  getLoader: GetLoader;
  readonlyStore: ReadonlyStore;
  metadataStore: MetadataStore;
};

export const buildGraphQLSchema = (schema: Schema): GraphQLSchema => {
  const queryFields: Record<string, GraphQLFieldConfig<Parent, Context>> = {};

  const { enumTypes } = buildEnumTypes({ schema });
  const { entityFilterTypes } = buildEntityFilterTypes({ schema, enumTypes });
  const { entityTypes, entityPageTypes } = buildEntityTypes({
    schema,
    enumTypes,
    entityFilterTypes,
  });

  for (const [tableName, { table }] of Object.entries(getTables(schema))) {
    const entityType = entityTypes[tableName]!;
    const entityPageType = entityPageTypes[tableName]!;
    const entityFilterType = entityFilterTypes[tableName]!;

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

  queryFields._meta = {
    type: metadataEntity,
    resolve: async (_source, _args, context) => {
      const status = await context.metadataStore.getStatus();
      return { status };
    },
  };

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: queryFields,
    }),
  });
};
