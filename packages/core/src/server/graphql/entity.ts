import {
  type GraphQLFieldConfigMap,
  GraphQLEnumType,
  GraphQLFieldResolver,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";

import { isEnumType, referencedEntityName } from "@/schema/schema";
import { Schema } from "@/schema/types";

import type { Context, Source } from "./schema";
import { tsTypeToGqlScalar } from "./schema";

export const buildEntityTypes = ({
  schema,
}: {
  schema: Schema;
}): Record<string, GraphQLObjectType<Source, Context>> => {
  const entityGqlTypes: Record<string, GraphQLObjectType<Source, Context>> = {};

  for (const [tableName, table] of Object.entries(schema.tables)) {
    entityGqlTypes[tableName] = new GraphQLObjectType({
      name: tableName,
      fields: () => {
        const fieldConfigMap: GraphQLFieldConfigMap<Source, Context> = {};

        Object.entries(table).forEach(([columnName, column]) => {
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
          } else if (isEnumType(column.type)) {
            const enumName = column.type.slice(5);
            const enumType = new GraphQLEnumType({
              name: enumName,
              values: schema.enums[enumName].reduce(
                (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
                {}
              ),
            });

            fieldConfigMap[columnName] = {
              type: column.optional ? new GraphQLNonNull(enumType) : enumType,
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
            };
          }
        });

        // Derived fields
        // check for other tables referencing this one
        const referencingEntities = Object.entries(schema.tables).filter(
          ([, t]) =>
            Object.values(t).some(
              (c) =>
                c.references && referencedEntityName(c.references) === tableName
            )
        );

        for (const [otherTableName, otherTable] of referencingEntities) {
          // Several columns can be referencing the table
          const referencingColumnNames = Object.entries(otherTable).filter(
            ([, column]) =>
              column.references &&
              referencedEntityName(column.references) === tableName
          );

          for (const [columnName] of referencingColumnNames) {
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
                modelName: otherTableName,
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
              `derived${
                columnName.charAt(0).toUpperCase() + columnName.slice(1)
              }`
            ] = {
              type: new GraphQLNonNull(
                new GraphQLList(
                  new GraphQLNonNull(entityGqlTypes[otherTableName])
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
  }

  return entityGqlTypes;
};
