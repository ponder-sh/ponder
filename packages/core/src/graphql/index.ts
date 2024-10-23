import type { OnchainTable } from "@/drizzle/db.js";
import type { Drizzle, Schema } from "@/drizzle/index.js";
import type { MetadataStore } from "@/indexing-store/metadata.js";
import {
  type Column,
  Many,
  One,
  type SQL,
  type TableRelationalConfig,
  and,
  arrayContained,
  arrayContains,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  is,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  notLike,
  or,
} from "drizzle-orm";
import { PgInteger, PgSerial } from "drizzle-orm/pg-core";
import {
  GraphQLBoolean,
  GraphQLEnumType,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigMap,
  GraphQLFloat,
  type GraphQLInputFieldConfigMap,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { GraphQLJSON } from "./json.js";
import type { GetDataLoader } from "./middleware.js";

export type Parent = Record<string, any>;
export type Context = {
  getDataLoader: GetDataLoader;
  metadataStore: MetadataStore;
};

export function buildGraphQLSchema(db: Drizzle<Schema>): GraphQLSchema {
  const tables = Object.values(db._.schema ?? {}) as TableRelationalConfig[];

  const enumTypes: Record<string, GraphQLEnumType> = {};
  for (const table of tables) {
    for (const column of Object.values(table.columns)) {
      if (column.enumValues !== undefined) {
        enumTypes[column.name] = new GraphQLEnumType({
          name: column.name,
          values: column.enumValues.reduce(
            (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
            {},
          ),
        });
      }
    }
  }

  const entityFilterTypes: Record<string, GraphQLInputObjectType> = {};
  for (const table of tables) {
    const filterType = new GraphQLInputObjectType({
      name: `${table.tsName}Filter`,
      fields: () => {
        const filterFields: GraphQLInputFieldConfigMap = {
          // Logical operators
          AND: { type: new GraphQLList(filterType) },
          OR: { type: new GraphQLList(filterType) },
        };

        for (const [columnName, column] of Object.entries(table.columns)) {
          const type = columnToGraphQLCore(column, enumTypes);

          // List fields => universal, plural
          if (type instanceof GraphQLList) {
            const baseType = innerType(type);

            filterOperators.universal.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type: new GraphQLList(baseType),
              };
            });

            filterOperators.plural.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = { type: baseType };
            });
          }

          // JSON => no filters.
          // Boolean => universal and singular only.
          // All other scalar => universal, singular, numeric OR string depending on type
          if (type instanceof GraphQLScalarType) {
            if (type.name === "JSON") continue;

            // TODO(kevin): Handle enums

            filterOperators.universal.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type,
              };
            });

            filterOperators.singular.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type: new GraphQLList(type),
              };
            });

            if (["String", "ID"].includes(type.name)) {
              filterOperators.string.forEach((suffix) => {
                filterFields[`${columnName}${suffix}`] = {
                  type: type,
                };
              });
            }

            if (["Int", "Float", "BigInt"].includes(type.name)) {
              filterOperators.numeric.forEach((suffix) => {
                filterFields[`${columnName}${suffix}`] = {
                  type: type,
                };
              });
            }
          }
        }

        return filterFields;
      },
    });
    entityFilterTypes[table.tsName] = filterType;
  }

  const entityTypes: Record<string, GraphQLObjectType<Parent, Context>> = {};
  const entityPageTypes: Record<string, GraphQLObjectType> = {};

  for (const table of tables) {
    entityTypes[table.tsName] = new GraphQLObjectType({
      name: table.tsName,
      fields: () => {
        const fieldConfigMap: GraphQLFieldConfigMap<Parent, Context> = {};

        for (const table of tables) {
          // Scalar fields
          for (const column of Object.values(table.columns)) {
            const type = columnToGraphQLCore(column, enumTypes);
            fieldConfigMap[column.name] = {
              type: column.notNull ? new GraphQLNonNull(type) : type,
            };
          }

          // Relations
          const relations = Object.entries(table.relations);
          for (const [relationName, relation] of relations) {
            const referencedTable = tables.find(
              (table) => table.dbName === relation.referencedTableName,
            );
            if (!referencedTable)
              throw new Error(
                `Internal error: Referenced table "${relation.referencedTableName}" not found`,
              );

            const referencedEntityType = entityTypes[referencedTable.tsName];
            const referencedEntityPageType =
              entityPageTypes[referencedTable.tsName];
            const referencedEntityFilterType =
              entityFilterTypes[referencedTable.tsName];
            if (
              referencedEntityType === undefined ||
              referencedEntityPageType === undefined ||
              referencedEntityFilterType === undefined
            )
              throw new Error(
                `Internal error: Referenced entity type not found for table "${referencedTable.tsName}" `,
              );

            const baseQuery = (db as Drizzle<{ [key: string]: OnchainTable }>)
              .query[referencedTable.tsName];
            if (!baseQuery)
              throw new Error(
                `Internal error: Referenced table "${referencedTable.tsName}" not found in RQB`,
              );

            if (is(relation, One)) {
              const fields = relation.config?.fields ?? [];
              const references = relation.config?.references ?? [];

              fieldConfigMap[relationName] = {
                // Note: This name is a bug in Drizzle.
                type: relation.isNullable
                  ? new GraphQLNonNull(referencedEntityType)
                  : referencedEntityType,
                resolve: async (parent, _args, context) => {
                  const conditions = [];
                  for (let i = 0; i < references.length; i++) {
                    const column = references[i]!;
                    const value = parent[fields[i]!.name];
                    conditions.push(eq(column, value));
                  }
                  const where =
                    conditions.length === 0
                      ? undefined
                      : conditions.length === 1
                        ? conditions[0]
                        : and(...conditions);

                  const row = await baseQuery.findFirst({ where });

                  return row;
                },
              };
            } else if (is(relation, Many)) {
              // Search the relations of the referenced table for the corresponding `one` relation.
              // If "relationName" is not provided, use the first `one` relation that references this table.
              const oneRelation = Object.values(referencedTable.relations).find(
                (relation) =>
                  relation.relationName === relationName ||
                  (is(relation, One) &&
                    relation.referencedTableName === table.dbName),
              ) as One | undefined;
              if (!oneRelation)
                throw new Error(
                  `Internal error: Relation "${relationName}" not found in table "${referencedTable.tsName}"`,
                );

              const fields = oneRelation.config?.fields ?? [];
              const references = oneRelation.config?.references ?? [];

              fieldConfigMap[relationName] = {
                type: referencedEntityPageType,
                args: {
                  where: { type: referencedEntityFilterType },
                  orderBy: { type: GraphQLString },
                  orderDirection: { type: GraphQLString },
                  before: { type: GraphQLString },
                  after: { type: GraphQLString },
                  limit: { type: GraphQLInt },
                },
                resolve: async (parent, args_, context) => {
                  const args = args_ as {
                    where?: { [key: string]: number | string };
                    after?: string;
                    before?: string;
                    limit?: number;
                    orderBy?: string;
                    orderDirection?: "asc" | "desc";
                  };

                  const argConditions = args.where
                    ? buildWhereConditions(args.where, referencedTable.columns)
                    : [];

                  const relationConditions = [];
                  for (let i = 0; i < references.length; i++) {
                    const column = fields[i]!;
                    const value = parent[references[i]!.name];
                    relationConditions.push(eq(column, value));
                  }

                  const conditions = [...argConditions, ...relationConditions];
                  const where =
                    conditions.length === 0
                      ? undefined
                      : conditions.length === 1
                        ? conditions[0]
                        : and(...conditions);

                  let orderBy: SQL[] | undefined;
                  if (args.orderBy !== undefined) {
                    const orderByColumn = referencedTable.columns[args.orderBy];
                    if (orderByColumn === undefined) {
                      throw new Error(
                        `Unknown column "${args.orderBy}" used in orderBy argument`,
                      );
                    }
                    orderBy =
                      (args.orderDirection ?? "asc") === "asc"
                        ? [asc(orderByColumn)]
                        : [desc(orderByColumn)];
                  }

                  const rows = await baseQuery.findMany({
                    where,
                    orderBy,
                  });

                  return {
                    items: rows,
                    pageInfo: {
                      hasNextPage: false,
                      hasPreviousPage: false,
                      startCursor: null,
                      endCursor: null,
                    },
                  };
                },
              };
            } else {
              throw new Error(
                `Internal error: Relation "${relationName}" is unsupported, expected One or Many`,
              );
            }
          }
        }

        return fieldConfigMap;
      },
    });

    entityPageTypes[table.tsName] = new GraphQLObjectType({
      name: `${table.tsName}Page`,
      fields: () => ({
        items: {
          type: new GraphQLNonNull(
            new GraphQLList(new GraphQLNonNull(entityTypes[table.tsName]!)),
          ),
        },
        pageInfo: { type: new GraphQLNonNull(GraphQLPageInfo) },
      }),
    });
  }

  const queryFields: Record<string, GraphQLFieldConfig<Parent, Context>> = {};
  for (const table of tables) {
    const entityType = entityTypes[table.tsName]!;
    const entityPageType = entityPageTypes[table.tsName]!;
    const entityFilterType = entityFilterTypes[table.tsName]!;

    const singularFieldName =
      table.tsName.charAt(0).toLowerCase() + table.tsName.slice(1);
    const pluralFieldName = `${singularFieldName}s`;

    const baseQuery = (db as Drizzle<{ [key: string]: OnchainTable }>).query[
      table.tsName
    ];
    if (!baseQuery)
      throw new Error(
        `Internal error: Table "${table.tsName}" not found in RQB`,
      );

    queryFields[singularFieldName] = {
      type: entityType,
      args: {
        // TODO: Handle composite primary keys
        id: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: async (_, args, context) => {
        const { id } = args as { id?: string };
        if (id === undefined) return null;

        const row = await baseQuery.findFirst();

        if (row === undefined) return null;

        // const encodedKey = encodeKey(table, row);
        // console.log(encodedKey);
        // const decodedKey = decodeKey(table, encodedKey);
        // console.log(decodedKey);

        return row;
      },
    };

    queryFields[pluralFieldName] = {
      type: new GraphQLNonNull(entityPageType),
      args: {
        where: { type: entityFilterType },
        orderBy: { type: GraphQLString },
        orderDirection: { type: GraphQLString },
        before: { type: GraphQLString },
        after: { type: GraphQLString },
        limit: { type: GraphQLInt },
      },
      resolve: async (_, args_, context) => {
        const args = args_ as {
          where?: { [key: string]: number | string };
          after?: string;
          before?: string;
          limit?: number;
          orderBy?: string;
          orderDirection?: "asc" | "desc";
        };

        let orderBy: SQL[] | undefined;
        if (args.orderBy !== undefined) {
          const orderByColumn = table.columns[args.orderBy];
          if (orderByColumn === undefined) {
            throw new Error(
              `Unknown column "${args.orderBy}" used in orderBy argument`,
            );
          }
          orderBy =
            (args.orderDirection ?? "asc") === "asc"
              ? [asc(orderByColumn)]
              : [desc(orderByColumn)];
        }

        const conditions = args.where
          ? buildWhereConditions(args.where, table.columns)
          : [];

        const where =
          conditions.length === 0
            ? undefined
            : conditions.length === 1
              ? conditions[0]
              : and(...conditions);

        const rows = await baseQuery.findMany({
          where,
          orderBy,
        });

        // console.log(
        //   baseQuery
        //     .findMany({
        //       where,
        //       orderBy,
        //     })
        //     .toSQL().sql,
        // );

        // console.log(rows);

        return {
          items: rows,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
        };
      },
    };
  }

  queryFields._meta = {
    type: GraphQLMeta,
    resolve: async (_source, _args, context) => {
      const status = await context.metadataStore.getStatus();
      return { status };
    },
  };

  return new GraphQLSchema({
    // Include these here so they are listed first in the printed schema.
    types: [GraphQLJSON, GraphQLBigInt, GraphQLPageInfo, GraphQLMeta],
    query: new GraphQLObjectType({
      name: "Query",
      fields: queryFields,
    }),
  });
}

const GraphQLPageInfo = new GraphQLObjectType({
  name: "PageInfo",
  fields: {
    hasNextPage: { type: new GraphQLNonNull(GraphQLBoolean) },
    hasPreviousPage: { type: new GraphQLNonNull(GraphQLBoolean) },
    startCursor: { type: GraphQLString },
    endCursor: { type: GraphQLString },
  },
});

const GraphQLBigInt = new GraphQLScalarType({
  name: "BigInt",
  serialize: (value) => String(value),
  parseValue: (value) => BigInt(value as any),
  parseLiteral: (value) => {
    if (value.kind === "StringValue") {
      return BigInt(value.value);
    } else {
      throw new Error(
        `Invalid value kind provided for field of type BigInt: ${value.kind}. Expected: StringValue`,
      );
    }
  },
});

const GraphQLMeta = new GraphQLObjectType({
  name: "Meta",
  fields: { status: { type: GraphQLJSON } },
});

const columnToGraphQLCore = (
  column: Column,
  enumTypes: Record<string, GraphQLEnumType>,
): GraphQLOutputType => {
  if (column.columnType === "PgNumeric" && (column as any).precision === 78) {
    return GraphQLBigInt;
  }

  switch (column.dataType) {
    case "boolean":
      return GraphQLBoolean;
    case "json":
      return GraphQLJSON;
    case "date":
      return GraphQLString;
    case "string":
      // TODO: Handle enums
      // if (column.enumValues?.length) return enumTypes[column.name]!;

      return GraphQLString;
    case "bigint":
      return GraphQLString;
    case "number":
      return is(column, PgInteger) || is(column, PgSerial)
        ? GraphQLInt
        : GraphQLFloat;
    case "buffer":
      return new GraphQLList(new GraphQLNonNull(GraphQLInt));
    case "array": {
      if (column.columnType === "PgVector") {
        return new GraphQLList(new GraphQLNonNull(GraphQLFloat));
      }

      if (column.columnType === "PgGeometry") {
        return new GraphQLList(new GraphQLNonNull(GraphQLFloat));
      }

      const innerType = columnToGraphQLCore(
        (column as any).baseColumn,
        enumTypes,
      );

      return new GraphQLList(new GraphQLNonNull(innerType));
    }
    default:
      throw new Error(`Type ${column.dataType} is not implemented`);
  }
};

const innerType = (type: GraphQLOutputType): GraphQLScalarType => {
  if (type instanceof GraphQLScalarType) return type;
  if (type instanceof GraphQLList || type instanceof GraphQLNonNull)
    return innerType(type.ofType);
  throw new Error(`Type ${type.toString()} is not implemented`);
};

const filterOperators = {
  universal: ["", "_not"],
  singular: ["_in", "_not_in"],
  plural: ["_has", "_not_has"],
  numeric: ["_gt", "_lt", "_gte", "_lte"],
  string: [
    "_contains",
    "_not_contains",
    "_starts_with",
    "_ends_with",
    "_not_starts_with",
    "_not_ends_with",
  ],
} as const;

export function buildWhereConditions(
  where: Record<string, any>,
  columns: Record<string, Column>,
): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];

  for (const [whereKey, rawValue] of Object.entries(where)) {
    // Handle the `AND` and `OR` operators
    if (whereKey === "AND" || whereKey === "OR") {
      if (!Array.isArray(rawValue)) {
        throw new Error(
          `Invalid query: Expected an array for the ${whereKey} operator. Got: ${rawValue}`,
        );
      }

      const nestedConditions = rawValue.flatMap((subWhere) =>
        buildWhereConditions(subWhere, columns),
      );

      if (nestedConditions.length > 0) {
        conditions.push(
          whereKey === "AND"
            ? and(...nestedConditions)
            : or(...nestedConditions),
        );
      }
      continue;
    }

    const [fieldName, condition_] = whereKey.split(/_(.*)/s);
    const condition = condition_ === undefined ? "" : condition_;

    if (!fieldName || !(fieldName in columns)) {
      throw new Error(`Invalid query: Unknown field ${fieldName}`);
    }

    const column = columns[fieldName]!;

    switch (condition) {
      case "":
        if (column.columnType === "PgArray") {
          conditions.push(
            and(
              arrayContains(column, rawValue),
              arrayContained(column, rawValue),
            ),
          );
        } else {
          conditions.push(eq(column, rawValue));
        }
        break;
      case "not":
        if (column.columnType === "PgArray") {
          conditions.push(
            not(
              and(
                arrayContains(column, rawValue),
                arrayContained(column, rawValue),
              )!,
            ),
          );
        } else {
          conditions.push(ne(column, rawValue));
        }
        break;
      case "in":
        conditions.push(inArray(column, rawValue));
        break;
      case "not_in":
        conditions.push(notInArray(column, rawValue));
        break;
      case "has":
        conditions.push(arrayContains(column, [rawValue]));
        break;
      case "not_has":
        conditions.push(not(arrayContains(column, [rawValue])));
        break;
      case "gt":
        conditions.push(gt(column, rawValue));
        break;
      case "lt":
        conditions.push(lt(column, rawValue));
        break;
      case "gte":
        conditions.push(gte(column, rawValue));
        break;
      case "lte":
        conditions.push(lte(column, rawValue));
        break;
      case "contains":
        conditions.push(like(column, `%${rawValue}%`));
        break;
      case "not_contains":
        conditions.push(notLike(column, `%${rawValue}%`));
        break;
      case "starts_with":
        conditions.push(like(column, `${rawValue}%`));
        break;
      case "ends_with":
        conditions.push(like(column, `%${rawValue}`));
        break;
      case "not_starts_with":
        conditions.push(notLike(column, `${rawValue}%`));
        break;
      case "not_ends_with":
        conditions.push(notLike(column, `%${rawValue}`));
        break;
      default:
        throw new Error(
          `Invalid query: Unknown condition ${condition} for field ${fieldName}`,
        );
    }
  }

  return conditions;
}

const encodeValue = (column: Column, value: unknown) => {
  // TODO(kyle) hack to get unblocked
  if (value === null) return null;
  if (column.mapToDriverValue === undefined) return value;
  return column.mapFromDriverValue(column.mapToDriverValue(value));
};

const decodeValue = (column: Column, value: unknown) => {
  if (column.mapFromDriverValue === undefined) return value;
  return column.mapToDriverValue(column.mapFromDriverValue(value));
};

const encodeKey = (
  table: TableRelationalConfig,
  row: { [key: string]: unknown },
): string => {
  const pkObject = Object.fromEntries(
    table.primaryKey.map((column) => [
      column.name,
      encodeValue(column, row[column.name]),
    ]),
  );
  return JSON.stringify(pkObject);
};

const decodeKey = (
  table: TableRelationalConfig,
  key: string,
): { [key: string]: unknown } => {
  const pkObject = JSON.parse(key);
  return Object.fromEntries(
    table.primaryKey.map((column) => [
      column.name,
      decodeValue(column, pkObject[column.name]),
    ]),
  );
};
