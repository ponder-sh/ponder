import type { GraphQLFieldResolver } from "graphql";
import {
  GraphQLEnumType,
  type GraphQLFieldConfigMap,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";

import type { ReferenceColumn, Schema } from "@/schema/types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  referencedTableName,
} from "@/schema/utils.js";

import type { Context, Source } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

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
          if (isOneColumn(column)) {
            // Column must resolve the foreign key of the referenced column
            // Note: this relies on the fact that reference columns can't be lists

            const referencedTable = referencedTableName(
              (table[column.referenceColumn] as ReferenceColumn).references,
            );

            const resolver: GraphQLFieldResolver<Source, Context> = async (
              parent,
              _args,
              context,
            ) => {
              const { store } = context;

              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              const relatedRecordId = parent[column.referenceColumn];

              return await store.findUnique({
                tableName: referencedTable,
                id: relatedRecordId,
              });
            };

            fieldConfigMap[columnName] = {
              type: entityGqlTypes[referencedTable],
              resolve: resolver,
            };
          } else if (isManyColumn(column)) {
            // Column is virtual meant to tell graphQL to make a field

            const resolver: GraphQLFieldResolver<Source, Context> = async (
              parent,
              args,
              context,
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
                tableName: column.referenceTable,
                timestamp: filter.timestamp ? filter.timestamp : undefined,
                where: { [column.referenceColumn]: entityId },
                skip: filter.skip,
                take: filter.first,
                orderBy: filter.orderBy
                  ? {
                      [filter.orderBy]: filter.orderDirection || "asc",
                    }
                  : undefined,
              });
            };

            fieldConfigMap[columnName] = {
              type: new GraphQLNonNull(
                new GraphQLList(
                  new GraphQLNonNull(entityGqlTypes[column.referenceTable]),
                ),
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
          } else if (isEnumColumn(column)) {
            // Note: this relies on the fact that there are no list enums
            const enumName = column.type;
            const enumType = new GraphQLEnumType({
              name: enumName,
              values: schema.enums[enumName].reduce(
                (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
                {},
              ),
            });

            fieldConfigMap[columnName] = {
              type: column.optional ? new GraphQLNonNull(enumType) : enumType,
            };
          } else if (column.list) {
            const listType = new GraphQLList(
              new GraphQLNonNull(tsTypeToGqlScalar[column.type]),
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

        return fieldConfigMap;
      },
    });
  }

  return entityGqlTypes;
};
