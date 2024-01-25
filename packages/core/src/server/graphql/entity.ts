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
import { maxCheckpoint } from "@/utils/checkpoint.js";

import type { PluralResolver } from "./plural.js";
import type { Context, Source } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

export const buildEntityTypes = ({ schema }: { schema: Schema }) => {
  const entityGqlTypes: Record<string, GraphQLObjectType<Source, Context>> = {};

  const enumGqlTypes: Record<string, GraphQLEnumType> = {};

  for (const [enumName, _enum] of Object.entries(schema.enums)) {
    enumGqlTypes[enumName] = new GraphQLEnumType({
      name: enumName,
      values: _enum.reduce(
        (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
        {},
      ),
    });
  }

  for (const [tableName, table] of Object.entries(schema.tables)) {
    entityGqlTypes[tableName] = new GraphQLObjectType({
      name: tableName,
      fields: () => {
        const fieldConfigMap: GraphQLFieldConfigMap<Source, Context> = {};

        Object.entries(table).forEach(([columnName, column]) => {
          if (isOneColumn(column)) {
            // Column must resolve the foreign key of the referenced column
            // Note: this relies on the fact that reference columns can't be lists

            const referenceColumn = table[
              column.referenceColumn
            ] as ReferenceColumn;

            const referencedTable = referencedTableName(
              referenceColumn.references,
            );

            const resolver: GraphQLFieldResolver<Source, Context> = async (
              parent,
              _args,
              context,
            ) => {
              const { store } = context;

              // @ts-ignore
              const relatedRecordId = parent[column.referenceColumn];

              // Note:
              if (relatedRecordId === null) return null;

              return await store.findUnique({
                tableName: referencedTable,
                id: relatedRecordId,
              });
            };

            fieldConfigMap[columnName] = {
              type: referenceColumn.optional
                ? entityGqlTypes[referencedTable]
                : new GraphQLNonNull(entityGqlTypes[referencedTable]),
              resolve: resolver,
            };
          } else if (isManyColumn(column)) {
            // Column is virtual meant to tell graphQL to make a field

            const resolver: PluralResolver = async (parent, args, context) => {
              const { store } = context;

              // The parent object gets passed in here with relationship fields defined as the
              // string ID of the related entity. Here, we get the ID and query for that entity.
              // Then, the GraphQL server serves the resolved object here instead of the ID.
              // @ts-ignore
              const entityId = parent.id;

              const filter = args;

              const checkpoint = filter.timestamp
                ? { ...maxCheckpoint, blockTimestamp: filter.timestamp }
                : undefined; // Latest.

              return await store.findMany({
                tableName: column.referenceTable,
                checkpoint,
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
          } else {
            const type = isEnumColumn(column)
              ? enumGqlTypes[column.type]
              : tsTypeToGqlScalar[column.type];
            if (column.list) {
              const listType = new GraphQLList(new GraphQLNonNull(type));
              fieldConfigMap[columnName] = {
                type: column.optional ? listType : new GraphQLNonNull(listType),
              };
            } else {
              fieldConfigMap[columnName] = {
                type: column.optional ? type : new GraphQLNonNull(type),
              };
            }
          }
        });

        return fieldConfigMap;
      },
    });
  }

  return { entityGqlTypes, enumGqlTypes };
};
