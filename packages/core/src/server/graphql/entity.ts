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

      Object.entries(entity.columns).forEach(([columnName, column]) => {
        if (column.references) {
          // Column is a reference to another table

          const referencedEntityName = (column.references as string).split(
            "."
          )[0];

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
            const relatedInstanceId = parent[columnName];

            return await store.findUnique({
              modelName: referencedEntityName,
              id: relatedInstanceId,
            });
          };

          fieldConfigMap[columnName] = {
            type: entityGqlTypes[referencedEntityName],
            resolve: resolver,
          };
        } else if (column.list) {
          const listType = new GraphQLList(
            new GraphQLNonNull(tsTypeToGqlScalar[column.type])
          );
          fieldConfigMap[columnName] = {
            type: column.optional ? listType : new GraphQLNonNull(listType),
          };
        } else {
          // Normal scalar

          fieldConfigMap[columnName] = {
            type: column.optional
              ? tsTypeToGqlScalar[column.type]
              : new GraphQLNonNull(tsTypeToGqlScalar[column.type]),
            // Convert bigints to strings for GraphQL responses.
            resolve:
              column.type === "bigint"
                ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  (parent) => (parent[columnName] as bigint).toString()
                : undefined,
          };
        }
      });

      return fieldConfigMap;
    },
  });
};
