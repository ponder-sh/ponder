import type { OnchainTable } from "@/drizzle/db.js";
import type { Drizzle, Schema } from "@/drizzle/index.js";
import type { MetadataStore } from "@/indexing-store/metadata.js";
import { deserialize, serialize } from "@/utils/serialize.js";
import DataLoader from "dataloader";
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
import type { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";
import {
  GraphQLBoolean,
  GraphQLEnumType,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigMap,
  GraphQLFloat,
  type GraphQLInputFieldConfigMap,
  GraphQLInputObjectType,
  type GraphQLInputType,
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

type Parent = Record<string, any>;
type Context = {
  getDataLoader: ReturnType<typeof buildDataLoaderCache>;
  metadataStore: MetadataStore;
};

type PluralArgs = {
  where?: { [key: string]: number | string };
  after?: string;
  before?: string;
  limit?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

const DEFAULT_LIMIT = 50 as const;
const MAX_LIMIT = 1000 as const;

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
                // Note: This naming is backwards (Drizzle bug).
                type: relation.isNullable
                  ? new GraphQLNonNull(referencedEntityType)
                  : referencedEntityType,
                resolve: async (parent, _args, context) => {
                  const loader = context.getDataLoader({
                    table: referencedTable,
                  });

                  const rowFragment: Record<string, unknown> = {};
                  for (let i = 0; i < references.length; i++) {
                    const column = references[i]!;
                    const value = parent[fields[i]!.name];
                    rowFragment[column.name] = value;
                  }
                  const encodedId = encodeRowFragment(rowFragment);

                  return await loader.load(encodedId);
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
                resolve: async (parent, args: PluralArgs, _context) => {
                  const relationalConditions = [];
                  for (let i = 0; i < references.length; i++) {
                    const column = fields[i]!;
                    const value = parent[references[i]!.name];
                    relationalConditions.push(eq(column, value));
                  }

                  return executePluralQuery(
                    table,
                    baseQuery,
                    args,
                    relationalConditions,
                  );
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
      // Find the primary key columns and GraphQL core types and include them
      // as arguments to the singular query type.
      args: Object.fromEntries(
        table.primaryKey.map((column) => [
          column.name,
          {
            type: new GraphQLNonNull(
              columnToGraphQLCore(column, enumTypes) as GraphQLInputType,
            ),
          },
        ]),
      ),
      resolve: async (_parent, args, _context) => {
        // The `args` object here should be a valid `where` argument that
        // uses the `eq` shorthand for each primary key column.
        const whereConditions = buildWhereConditions(args, table.columns);

        const row = await baseQuery.findFirst({
          where: and(...whereConditions),
        });
        return row ?? null;
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
      resolve: async (_parent, args: PluralArgs, _context) => {
        return executePluralQuery(table, baseQuery, args);
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

async function executePluralQuery(
  table: TableRelationalConfig,
  baseQuery: RelationalQueryBuilder<any, any>,
  args: PluralArgs,
  extraConditions: (SQL | undefined)[] = [],
) {
  const limit = args.limit ?? DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) {
    throw new Error(`Invalid limit. Got ${limit}, expected <=${MAX_LIMIT}.`);
  }

  const orderBySchema = buildOrderBySchema(table, args);
  const orderBy = orderBySchema.map(([columnName, direction]) => {
    const column = table.columns[columnName];
    if (column === undefined) {
      throw new Error(
        `Unknown column "${columnName}" used in orderBy argument`,
      );
    }
    return direction === "asc" ? asc(column) : desc(column);
  });
  const orderByReversed = orderBySchema.map(([columnName, direction]) => {
    const column = table.columns[columnName];
    if (column === undefined) {
      throw new Error(
        `Unknown column "${columnName}" used in orderBy argument`,
      );
    }
    return direction === "asc" ? desc(column) : asc(column);
  });

  const whereConditions = buildWhereConditions(args.where, table.columns);

  const after = args.after ?? null;
  const before = args.before ?? null;

  let startCursor = null;
  let endCursor = null;
  let hasPreviousPage = false;
  let hasNextPage = false;

  if (after !== null && before !== null) {
    throw new Error("Cannot specify both before and after cursors.");
  }

  // Neither cursors are specified, apply the order conditions and execute.
  if (after === null && before === null) {
    const rows = await baseQuery.findMany({
      where: and(...whereConditions, ...extraConditions),
      orderBy,
      limit: limit + 1,
    });

    if (rows.length === limit + 1) {
      rows.pop();
      hasNextPage = true;
    }

    startCursor =
      rows.length > 0 ? encodeCursor(orderBySchema, rows[0]!) : null;
    endCursor =
      rows.length > 0
        ? encodeCursor(orderBySchema, rows[rows.length - 1]!)
        : null;

    return {
      items: rows,
      pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
    };
  }

  if (after !== null) {
    // User specified an 'after' cursor.
    const cursorObject = decodeCursor(after);
    const cursorCondition = buildCursorCondition(
      table,
      orderBySchema,
      "after",
      cursorObject,
    );

    const rows = await baseQuery.findMany({
      where: and(...whereConditions, cursorCondition, ...extraConditions),
      orderBy,
      limit: limit + 2,
    });

    if (rows.length === 0) {
      return {
        items: rows,
        pageInfo: {
          hasNextPage,
          hasPreviousPage,
          startCursor,
          endCursor,
        },
      };
    }

    // If the cursor of the first returned record equals the `after` cursor,
    // `hasPreviousPage` is true. Remove that record.
    if (encodeCursor(orderBySchema, rows[0]!) === after) {
      rows.shift();
      hasPreviousPage = true;
    } else {
      // Otherwise, remove the last record.
      rows.pop();
    }

    // Now if the length of the records is still equal to limit + 1,
    // there is a next page.
    if (rows.length === limit + 1) {
      rows.pop();
      hasNextPage = true;
    }

    // Now calculate the cursors.
    startCursor =
      rows.length > 0 ? encodeCursor(orderBySchema, rows[0]!) : null;
    endCursor =
      rows.length > 0
        ? encodeCursor(orderBySchema, rows[rows.length - 1]!)
        : null;

    return {
      items: rows,
      pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
    };
  }

  // User specified a 'before' cursor.
  const cursorObject = decodeCursor(before!);
  const cursorCondition = buildCursorCondition(
    table,
    orderBySchema,
    "before",
    cursorObject,
  );

  // Reverse the order by conditions to get the previous page,
  // then reverse the results back to the original order.
  const rows = await baseQuery
    .findMany({
      where: and(...whereConditions, cursorCondition, ...extraConditions),
      orderBy: orderByReversed,
      limit: limit + 2,
    })
    .then((rows) => rows.reverse());

  if (rows.length === 0) {
    return {
      items: rows,
      pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
    };
  }

  // If the cursor of the last returned record equals the `before` cursor,
  // `hasNextPage` is true. Remove that record.
  if (encodeCursor(orderBySchema, rows[rows.length - 1]!) === before) {
    rows.pop();
    hasNextPage = true;
  } else {
    // Otherwise, remove the first record.
    rows.shift();
  }

  // Now if the length of the records is equal to limit + 1, we know
  // there is a previous page.
  if (rows.length === limit + 1) {
    rows.shift();
    hasPreviousPage = true;
  }

  // Now calculate the cursors.
  startCursor = rows.length > 0 ? encodeCursor(orderBySchema, rows[0]!) : null;
  endCursor =
    rows.length > 0
      ? encodeCursor(orderBySchema, rows[rows.length - 1]!)
      : null;

  return {
    items: rows,
    pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
  };
}

function buildWhereConditions(
  where: Record<string, any> | undefined,
  columns: Record<string, Column>,
): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [];

  if (where === undefined) return conditions;

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

function buildOrderBySchema(table: TableRelationalConfig, args: PluralArgs) {
  // If the user-provided order by does not include the ALL of the ID columns,
  // add any missing ID columns to the end of the order by clause (asc).
  // This ensures a consistent sort order to unblock cursor pagination.
  const userDirection = args.orderDirection ?? "asc";
  const userColumns: [string, "asc" | "desc"][] =
    args.orderBy !== undefined ? [[args.orderBy, userDirection]] : [];
  const pkColumns = table.primaryKey.map((column) => [
    column.name,
    userDirection,
  ]);
  const missingPkColumns = pkColumns.filter(
    (pkColumn) =>
      !userColumns.some((userColumn) => userColumn[0] === pkColumn[0]),
  ) as [string, "asc" | "desc"][];
  return [...userColumns, ...missingPkColumns];
}

function encodeCursor(
  orderBySchema: [string, "asc" | "desc"][],
  row: { [k: string]: unknown },
): string {
  const cursorObject = Object.fromEntries(
    orderBySchema.map(([columnName, _]) => [columnName, row[columnName]]),
  );
  return encodeRowFragment(cursorObject);
}
function decodeCursor(cursor: string): { [k: string]: unknown } {
  return decodeRowFragment(cursor);
}

function encodeRowFragment(rowFragment: { [k: string]: unknown }): string {
  return Buffer.from(serialize(rowFragment)).toString("base64");
}
function decodeRowFragment(encodedRowFragment: string): {
  [k: string]: unknown;
} {
  return deserialize(Buffer.from(encodedRowFragment, "base64").toString());
}

function buildCursorCondition(
  table: TableRelationalConfig,
  orderBySchema: [string, "asc" | "desc"][],
  direction: "after" | "before",
  cursorObject: { [k: string]: unknown },
): SQL | undefined {
  const cursorColumns = orderBySchema.map(([columnName, orderDirection]) => {
    const column = table.columns[columnName];
    if (column === undefined)
      throw new Error(
        `Unknown column "${columnName}" used in orderBy argument`,
      );

    const value = cursorObject[columnName];

    let comparator: typeof gt | typeof lt;
    let comparatorOrEquals: typeof gte | typeof lte;
    if (direction === "after") {
      [comparator, comparatorOrEquals] =
        orderDirection === "asc" ? [gt, gte] : [lt, lte];
    } else {
      [comparator, comparatorOrEquals] =
        orderDirection === "asc" ? [lt, lte] : [gt, gte];
    }

    return { column, value, comparator, comparatorOrEquals };
  });

  const buildCondition = (index: number): SQL | undefined => {
    if (index === cursorColumns.length - 1) {
      const { column, value, comparatorOrEquals } = cursorColumns[index]!;
      return comparatorOrEquals(column, value);
    }

    const currentColumn = cursorColumns[index]!;
    const nextCondition = buildCondition(index + 1);

    return or(
      currentColumn.comparator(currentColumn.column, currentColumn.value),
      and(eq(currentColumn.column, currentColumn.value), nextCondition),
    );
  };

  return buildCondition(0);
}

export function buildDataLoaderCache({
  drizzle,
}: { drizzle: Drizzle<Schema> }) {
  const dataLoaderMap = new Map<
    TableRelationalConfig,
    DataLoader<string, any> | undefined
  >();
  return ({ table }: { table: TableRelationalConfig }) => {
    const baseQuery = (drizzle as Drizzle<{ [key: string]: OnchainTable }>)
      .query[table.tsName];
    if (baseQuery === undefined)
      throw new Error(
        `Internal error: Unknown table "${table.tsName}" in data loader cache`,
      );

    let dataLoader = dataLoaderMap.get(table);
    if (dataLoader === undefined) {
      dataLoader = new DataLoader(
        async (encodedIds) => {
          const decodedRowFragments = encodedIds.map(decodeRowFragment);

          const idConditions = decodedRowFragments.map((decodedRowFragment) =>
            and(
              ...Object.entries(decodedRowFragment).map(([col, val]) =>
                eq(table.columns[col]!, val),
              ),
            ),
          );

          const rows = await baseQuery.findMany({
            where: or(...idConditions),
            limit: encodedIds.length,
          });

          return decodedRowFragments.map((decodedRowFragment) => {
            return rows.find((row) =>
              Object.entries(decodedRowFragment).every(
                ([col, val]) => row[col] === val,
              ),
            );
          });
        },
        { maxBatchSize: 1_000 },
      );
      dataLoaderMap.set(table, dataLoader);
    }

    return dataLoader;
  };
}
