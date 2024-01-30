import type { ReferenceColumn, Schema } from "@/schema/types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  referencedTableName,
} from "@/schema/utils.js";
import { maxCheckpoint } from "@/utils/checkpoint.js";
import { GraphQLBoolean, type GraphQLFieldResolver } from "graphql";
import {
  GraphQLEnumType,
  type GraphQLFieldConfigMap,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import type { PluralResolver } from "./plural.js";
import { type Context, type Source } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

const GraphQLPageInfo = new GraphQLObjectType({
  name: "PageInfo",
  fields: {
    hasNextPage: { type: new GraphQLNonNull(GraphQLBoolean) },
    hasPreviousPage: { type: new GraphQLNonNull(GraphQLBoolean) },
    startCursor: { type: GraphQLString },
    endCursor: { type: GraphQLString },
  },
});

export const buildEntityTypes = ({ schema }: { schema: Schema }) => {
  const enumTypes: Record<string, GraphQLEnumType> = {};
  const entityTypes: Record<string, GraphQLObjectType<Source, Context>> = {};
  const entityPageTypes: Record<string, GraphQLObjectType> = {};

  for (const [enumName, _enum] of Object.entries(schema.enums)) {
    enumTypes[enumName] = new GraphQLEnumType({
      name: enumName,
      values: _enum.reduce(
        (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
        {},
      ),
    });
  }

  for (const [tableName, table] of Object.entries(schema.tables)) {
    entityTypes[tableName] = new GraphQLObjectType({
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

              // Note: Don't query with a null or undefined id, indexing store will throw error.
              if (relatedRecordId === null || relatedRecordId === undefined)
                return null;

              return await store.findUnique({
                tableName: referencedTable,
                id: relatedRecordId,
              });
            };

            fieldConfigMap[columnName] = {
              type: referenceColumn.optional
                ? entityTypes[referencedTable]
                : new GraphQLNonNull(entityTypes[referencedTable]),
              resolve: resolver,
            };
          } else if (isManyColumn(column)) {
            const resolver: PluralResolver = async (parent, args, context) => {
              const { store } = context;

              const {
                timestamp,
                where,
                orderBy,
                orderDirection,
                limit,
                after,
                before,
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

              const orderByObject = orderBy
                ? { [orderBy]: orderDirection || "asc" }
                : undefined;

              return await store.findMany({
                tableName: column.referenceTable,
                checkpoint,
                where: whereObject,
                orderBy: orderByObject,
                limit,
                before,
                after,
              });
            };

            fieldConfigMap[columnName] = {
              type: entityPageTypes[column.referenceTable],
              args: {
                timestamp: { type: GraphQLInt },
                orderBy: { type: GraphQLString },
                orderDirection: { type: GraphQLString },
                before: { type: GraphQLString },
                after: { type: GraphQLString },
                limit: { type: GraphQLInt },
              },
              resolve: resolver,
            };
          } else {
            const type = isEnumColumn(column)
              ? enumTypes[column.type]
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

    entityPageTypes[tableName] = new GraphQLObjectType({
      name: `${tableName}Page`,
      fields: () => ({
        items: {
          type: new GraphQLList(new GraphQLNonNull(entityTypes[tableName])),
        },
        pageInfo: { type: GraphQLPageInfo },
      }),
    });
  }

  return { entityTypes, entityPageTypes, enumTypes };
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
