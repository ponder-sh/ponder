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

import type { Row } from "@/indexing-store/store.js";
import type { PluralResolver } from "./plural.js";
import type { Context, Source } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

type PluralPage = {
  items: Row[];
  before: string;
  after: string;
  hasNext: boolean;
};

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

              const {
                timestamp,
                where,
                after,
                before,
                limit,
                orderBy,
                orderDirection,
              } = args;

              // The parent object gets passed in here with relationship fields defined as the
              // string ID of the related entity. Here, we get the ID and query for that entity.
              // Then, the GraphQL server serves the resolved object here instead of the ID.
              // @ts-ignore
              const entityId = parent.id;

              const checkpoint = timestamp
                ? { ...maxCheckpoint, blockTimestamp: timestamp }
                : undefined; // Latest.

              const whereObject = where ? buildWhereObject({ where }) : {};
              whereObject[column.referenceColumn] = entityId;

              if (after && before) {
                throw Error(
                  "Cannot have both 'before' and 'after' cursor search",
                );
              }

              const res = await store.findManyPaginated({
                tableName: column.referenceTable,
                checkpoint,
                where: whereObject,
                before: before,
                after: after,
                take: limit || 1000,
                orderBy: orderBy
                  ? {
                      [orderBy]: orderDirection || "asc",
                    }
                  : { id: orderDirection || "asc" },
              });

              return {
                items: res.rows,
                after: res.after,
                before: res.before,
              } as PluralPage;
            };
            const pageType = new GraphQLObjectType({
              name: `${tableName}PageChild`,
              fields: () => ({
                items: {
                  type: new GraphQLList(
                    new GraphQLNonNull(entityGqlTypes[column.referenceTable]),
                  ),
                },
                before: {
                  type: GraphQLString,
                },
                after: {
                  type: GraphQLString,
                },
              }),
            });

            fieldConfigMap[columnName] = {
              type: pageType,
              args: {
                before: { type: GraphQLString, defaultValue: "" },
                after: { type: GraphQLString, defaultValue: "" },
                limit: { type: GraphQLInt, defaultValue: 100 },
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

const graphqlFilterToStoreCondition = {
  "": "equals",
  not: "not",
  in: "in",
  not_in: "notIn",
  has: "has",
  not_has: "notHas",
  gt: "gt",
  lt: "lt",
  gte: "gte",
  lte: "lte",
  contains: "contains",
  not_contains: "notContains",
  starts_with: "startsWith",
  not_starts_with: "notStartsWith",
  ends_with: "endsWith",
  not_ends_with: "notEndsWith",
} as const;

function buildWhereObject({ where }: { where: Record<string, any> }) {
  const whereObject: Record<string, any> = {};

  Object.entries(where).forEach(([whereKey, rawValue]) => {
    const [fieldName, condition_] = whereKey.split(/_(.*)/s);
    // This is a hack to handle the "" operator, which the regex above doesn't handle
    const condition = (
      condition_ === undefined ? "" : condition_
    ) as keyof typeof graphqlFilterToStoreCondition;

    const storeCondition = graphqlFilterToStoreCondition[condition];
    if (!storeCondition) {
      throw new Error(
        `Invalid query: Unknown where condition: ${fieldName}_${condition}`,
      );
    }

    whereObject[fieldName] = { [storeCondition]: rawValue };
  });

  return whereObject;
}
