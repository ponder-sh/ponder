import {
  type GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
} from "graphql";

import type { Entity } from "@/schema/types";

import type { Context, Source } from "./schema";
import { tsTypeToGqlScalar } from "./schema";

export const buildEntityType = ({
  entity,
  entityGqlTypes,
}: {
  entity: Entity;
  entityGqlTypes: Record<string, GraphQLObjectType<Source, Context>>;
}): GraphQLObjectType<Source, Context> => {
  return new GraphQLObjectType({
    name: entity.name,
    fields: () => {
      const fieldConfigMap: GraphQLFieldConfigMap<Source, Context> = {};

      Object.keys(entity.columns).forEach((key) => {
        if (entity.columns[key].references) {
          const resolver: GraphQLFieldResolver<Source, Context> = async (
            parent,
            _args,
            context
          ) => {
            const { store } = context;

            // The parent object gets passed in here with relationship fields defined as the
            // string ID of the related entity. Here, we get the ID and query for that entity.
            // Then, the GraphQL server serves the resolved object here instead of the ID.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const relatedInstanceId = parent[key];

            return await store.findUnique({
              modelName: (entity.columns[key].references as string).split(
                "."
              )[0],
              id: relatedInstanceId,
            });
          };

          fieldConfigMap[key] = {
            type: entityGqlTypes[
              (entity.columns[key].references as string).split(".")[0]
            ],
            resolve: resolver,
          };
        } else if (!entity.columns[key].list) {
          fieldConfigMap[key] = {
            type: !entity.columns[key].optional
              ? new GraphQLNonNull(tsTypeToGqlScalar[entity.columns[key].type])
              : tsTypeToGqlScalar[entity.columns[key].type],
            // Convert bigints to strings for GraphQL responses.
            resolve:
              entity.columns[key].type === "bigint"
                ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  (parent) => (parent[key] as bigint).toString()
                : undefined,
          };
        } else {
          const listType = new GraphQLList(
            new GraphQLNonNull(tsTypeToGqlScalar[entity.columns[key].type])
          );
          fieldConfigMap[key] = {
            type: !entity.columns[key].optional
              ? new GraphQLNonNull(listType)
              : listType,
          };
        }
      });

      return fieldConfigMap;
    },
  });
};
