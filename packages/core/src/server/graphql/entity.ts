import {
  type GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";

import { referencedEntityName } from "@/schema/schema";
import type { Entity } from "@/schema/types";

import type { Context, Source } from "./schema";
import { tsTypeToGqlScalar } from "./schema";

export const buildEntityType = ({
  entity,
  entities,
  entityGqlTypes,
}: {
  entity: Entity;
  entities: readonly Entity[];
  entityGqlTypes: Record<string, GraphQLObjectType<Source, Context>>;
}): GraphQLObjectType<Source, Context> => {
  return new GraphQLObjectType({
    name: entity.name,
    fields: () => {
      const fieldConfigMap: GraphQLFieldConfigMap<Source, Context> = {};

      Object.entries(entity.columns).forEach(([columnName, column]) => {
        if (column.references) {
          // Column is a reference to another table

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
              modelName: referencedEntityName(column.references),
              id: relatedInstanceId,
            });
          };

          fieldConfigMap[columnName] = {
            type: entityGqlTypes[referencedEntityName(column.references)],
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

      // Derived fields
      // check for other tables referencing this one
      const referencingEntities = entities.filter((t) =>
        Object.values(t.columns).some(
          (c) =>
            c.references && referencedEntityName(c.references) === entity.name
        )
      );

      for (const otherEntity of referencingEntities) {
        // Several columns can be referencing the table
        const referencingColumnNames = Object.entries(otherEntity.columns)
          .filter(
            ([, column]) =>
              column.references &&
              referencedEntityName(column.references) === entity.name
          )
          .map((c) => c[0]);

        for (const columnName of referencingColumnNames) {
          const resolver: GraphQLFieldResolver<Source, Context> = async (
            parent,
            args,
            context
          ) => {
            const { store } = context;

            // The parent object gets passed in here with relationship fields defined as the
            // string ID of the related entity. Here, we get the ID and query for that entity.
            // Then, the GraphQL server serves the resolved object here instead of the ID.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const entityId = parent.id;

            const filter = args;

            return await store.findMany({
              modelName: otherEntity.name,
              timestamp: filter.timestamp ? filter.timestamp : undefined,
              where: { [columnName]: entityId },
              skip: filter.skip,
              take: filter.first,
              orderBy: filter.orderBy
                ? {
                    [filter.orderBy]: filter.orderDirection || "asc",
                  }
                : undefined,
            });
          };

          fieldConfigMap[
            `derived${columnName.charAt(0).toUpperCase() + columnName.slice(1)}`
          ] = {
            type: new GraphQLNonNull(
              new GraphQLList(
                new GraphQLNonNull(entityGqlTypes[otherEntity.name])
              )
            ),
            args: {
              skip: { type: GraphQLInt, defaultValue: 0 },
              first: { type: GraphQLInt, defaultValue: 100 },
              orderBy: { type: GraphQLString, defaultValue: "id" },
              orderDirection: { type: GraphQLString, defaultValue: "asc" },
              timestamp: { type: GraphQLInt },
            },
            resolve: resolver,
          };
        }
      }

      return fieldConfigMap;
    },
  });
};
