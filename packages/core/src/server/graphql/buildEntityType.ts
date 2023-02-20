import {
  GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
} from "graphql";

import type { Entity } from "@/schema/types";
import { FieldKind } from "@/schema/types";

import type { Context, Source } from "./buildGqlSchema";

export const buildEntityType = (
  entity: Entity,
  entityTypes: Record<string, GraphQLObjectType<Source, Context>>
): GraphQLObjectType<Source, Context> => {
  return new GraphQLObjectType({
    name: entity.name,
    fields: () => {
      const fieldConfigMap: GraphQLFieldConfigMap<Source, Context> = {};

      // Build resolvers for relationship fields on the entity.
      entity.fields.forEach((field) => {
        switch (field.kind) {
          case FieldKind.RELATIONSHIP: {
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
              const relatedEntityId = parent[field.name];

              return await store.getEntity(
                field.baseGqlType.name,
                relatedEntityId
              );
            };

            fieldConfigMap[field.name] = {
              type: entityTypes[field.baseGqlType.name],
              resolve: resolver,
            };

            break;
          }
          case FieldKind.DERIVED: {
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

              return await store.getEntityDerivedField(
                entity.name,
                entityId,
                field.name
              );
            };

            fieldConfigMap[field.name] = {
              type: new GraphQLNonNull(
                new GraphQLList(
                  new GraphQLNonNull(entityTypes[field.baseGqlType.name])
                )
              ),
              resolve: resolver,
            };

            break;
          }
          case FieldKind.LIST: {
            const listType = new GraphQLList(
              new GraphQLNonNull(field.baseGqlType as GraphQLOutputType)
            );
            fieldConfigMap[field.name] = {
              type: field.notNull ? new GraphQLNonNull(listType) : listType,
            };
            break;
          }
          default: {
            fieldConfigMap[field.name] = {
              type: field.notNull
                ? new GraphQLNonNull(field.baseGqlType)
                : field.baseGqlType,
            };
            break;
          }
        }
      });

      return fieldConfigMap;
    },
  });
};
