import type { ReferenceColumn, Schema } from "@/schema/types.js";
import {
  isEnumColumn,
  isManyColumn,
  isOneColumn,
  referencedTableName,
} from "@/schema/utils.js";
import {
  GraphQLBoolean,
  type GraphQLFieldResolver,
  GraphQLInputObjectType,
} from "graphql";
import {
  GraphQLEnumType,
  type GraphQLFieldConfigMap,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { buildWhereObject } from "./filter.js";
import type { PluralResolver } from "./plural.js";
import type { Context, Parent } from "./schema.js";
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

export const buildEntityTypes = ({
  schema,
  enumTypes,
  entityFilterTypes,
}: {
  schema: Schema;
  enumTypes: Record<string, GraphQLEnumType>;
  entityFilterTypes: Record<string, GraphQLInputObjectType>;
}) => {
  const entityTypes: Record<string, GraphQLObjectType<Parent, Context>> = {};
  const entityPageTypes: Record<string, GraphQLObjectType> = {};

  for (const [tableName, table] of Object.entries(schema.tables)) {
    entityTypes[tableName] = new GraphQLObjectType({
      name: tableName,
      fields: () => {
        const fieldConfigMap: GraphQLFieldConfigMap<Parent, Context> = {};

        Object.entries(table).forEach(([columnName, column]) => {
          if (isOneColumn(column)) {
            // Column must resolve the foreign key of the referenced column
            // Note: this relies on the fact that reference columns can't be lists.
            const referenceColumn = table[
              column.referenceColumn
            ] as ReferenceColumn;
            const referencedTable = referencedTableName(
              referenceColumn.references,
            );

            const resolver: GraphQLFieldResolver<Parent, Context> = async (
              parent,
              _args,
              context,
            ) => {
              // The parent object gets passed in here containing reference column values.
              const relatedRecordId = parent[column.referenceColumn];
              // Note: Don't query with a null or undefined id, indexing store will throw error.
              if (relatedRecordId === null || relatedRecordId === undefined)
                return null;

              const loader = context.getLoader({
                tableName: referencedTable,
              });

              return await loader.load(relatedRecordId);
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

              const { where, orderBy, orderDirection, limit, after, before } =
                args;

              const whereObject = where ? buildWhereObject(where) : {};
              // Add the parent record ID to the where object.
              // Note that this overrides any existing equals condition.
              (whereObject[column.referenceColumn] ??= {}).equals = parent.id;

              const orderByObject = orderBy
                ? { [orderBy]: orderDirection ?? "asc" }
                : undefined;

              // Query for the IDs of the matching records.
              // TODO: Update query to only fetch IDs, not entire records.
              const result = await store.findMany({
                tableName: column.referenceTable,
                where: whereObject,
                orderBy: orderByObject,
                limit,
                before,
                after,
              });

              // Load entire records objects using the loader.
              const loader = context.getLoader({
                tableName: column.referenceTable,
              });

              const ids = result.items.map((item) => item.id);
              const items = await loader.loadMany(ids);

              return { items, pageInfo: result.pageInfo };
            };

            fieldConfigMap[columnName] = {
              type: entityPageTypes[column.referenceTable],
              args: {
                where: { type: entityFilterTypes[tableName] },
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
          type: new GraphQLNonNull(
            new GraphQLList(new GraphQLNonNull(entityTypes[tableName])),
          ),
        },
        pageInfo: { type: new GraphQLNonNull(GraphQLPageInfo) },
      }),
    });
  }

  return { entityTypes, entityPageTypes };
};
