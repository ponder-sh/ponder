import type { Drizzle, OnchainTable, Schema } from "@/drizzle/index.js";
import type { MetadataStore } from "@/indexing-store/metadata.js";
import { never } from "@/utils/never.js";
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
  count,
  createTableRelationsHelpers,
  desc,
  eq,
  extractTablesRelationalConfig,
  getTableColumns,
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
import {
  type PgEnum,
  PgInteger,
  PgSerial,
  isPgEnum,
} from "drizzle-orm/pg-core";
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
  type GraphQLResolveInfo,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { GraphQLJSON } from "./json.js";

type Parent = Record<string, any>;
type Context = {
  getDataLoader: ReturnType<typeof buildDataLoaderCache>;
  metadataStore: MetadataStore;
  drizzle: Drizzle<{ [key: string]: OnchainTable }>;
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

export function buildGraphQLSchema(schema: Schema): GraphQLSchema {
  const tablesConfig = extractTablesRelationalConfig(
    schema,
    createTableRelationsHelpers,
  );

  const tables = Object.values(tablesConfig.tables) as TableRelationalConfig[];

  const enums = Object.entries(schema).filter(
    (el): el is [string, PgEnum<[string, ...string[]]>] => isPgEnum(el[1]),
  );
  const enumTypes: Record<string, GraphQLEnumType> = {};
  for (const [enumTsName, enumObject] of enums) {
    // Note that this is keyed by enumName (the SQL name) because that's what is
    // available on the PgEnumColumn type. See `columnToGraphQLCore` for context.
    enumTypes[enumObject.enumName] = new GraphQLEnumType({
      name: enumTsName,
      values: enumObject.enumValues.reduce(
        (acc: Record<string, {}>, cur) => ({ ...acc, [cur]: {} }),
        {},
      ),
    });
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

            conditionSuffixes.universal.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type: new GraphQLList(baseType),
              };
            });

            conditionSuffixes.plural.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = { type: baseType };
            });
          }

          // JSON => no filters.
          // Boolean => universal and singular only.
          // All other scalar => universal, singular, numeric OR string depending on type
          if (
            type instanceof GraphQLScalarType ||
            type instanceof GraphQLEnumType
          ) {
            if (type.name === "JSON") continue;

            conditionSuffixes.universal.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type,
              };
            });

            conditionSuffixes.singular.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type: new GraphQLList(type),
              };
            });

            if (["String", "ID"].includes(type.name)) {
              conditionSuffixes.string.forEach((suffix) => {
                filterFields[`${columnName}${suffix}`] = {
                  type: type,
                };
              });
            }

            if (["Int", "Float", "BigInt"].includes(type.name)) {
              conditionSuffixes.numeric.forEach((suffix) => {
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

        // Scalar fields
        for (const [columnName, column] of Object.entries(table.columns)) {
          const type = columnToGraphQLCore(column, enumTypes);
          fieldConfigMap[columnName] = {
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
              `Internal error: Referenced entity types not found for table "${referencedTable.tsName}" `,
            );

          if (is(relation, One)) {
            const fields = relation.config?.fields ?? [];
            const references = relation.config?.references ?? [];

            if (fields.length !== references.length) {
              throw new Error(
                "Internal error: Fields and references arrays must be the same length",
              );
            }

            fieldConfigMap[relationName] = {
              // Note: There is a `relation.isNullable` field here but it appears
              // to be internal / incorrect. Until we have support for foriegn
              // key constraints, all `one` relations must be nullable.
              type: referencedEntityType,
              resolve: (parent, _args, context) => {
                const loader = context.getDataLoader({
                  table: referencedTable,
                });

                const rowFragment: Record<string, unknown> = {};
                for (let i = 0; i < references.length; i++) {
                  const referenceColumn = references[i]!;
                  const fieldColumn = fields[i]!;

                  const fieldColumnTsName = getColumnTsName(fieldColumn);
                  const referenceColumnTsName =
                    getColumnTsName(referenceColumn);

                  rowFragment[referenceColumnTsName] =
                    parent[fieldColumnTsName];
                }
                const encodedId = encodeRowFragment(rowFragment);

                return loader.load(encodedId);
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
              resolve: (parent, args: PluralArgs, context, info) => {
                const relationalConditions = [];
                for (let i = 0; i < references.length; i++) {
                  const column = fields[i]!;
                  const value = parent[references[i]!.name];
                  relationalConditions.push(eq(column, value));
                }

                const includeTotalCount = selectionIncludesField(
                  info,
                  "totalCount",
                );

                return executePluralQuery(
                  referencedTable,
                  context.drizzle,
                  args,
                  includeTotalCount,
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
        totalCount: { type: new GraphQLNonNull(GraphQLInt) },
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

    queryFields[singularFieldName] = {
      type: entityType,
      // Find the primary key columns and GraphQL core types and include them
      // as arguments to the singular query type.
      args: Object.fromEntries(
        table.primaryKey.map((column) => [
          getColumnTsName(column),
          {
            type: new GraphQLNonNull(
              columnToGraphQLCore(column, enumTypes) as GraphQLInputType,
            ),
          },
        ]),
      ),
      resolve: async (_parent, args, context) => {
        const loader = context.getDataLoader({ table });

        // The `args` object here should be a valid `where` argument that
        // uses the `eq` shorthand for each primary key column.
        const encodedId = encodeRowFragment(args);

        return loader.load(encodedId);
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
      resolve: async (_parent, args: PluralArgs, context, info) => {
        const includeTotalCount = selectionIncludesField(info, "totalCount");

        return executePluralQuery(
          table,
          context.drizzle,
          args,
          includeTotalCount,
        );
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
  if (column.columnType === "PgEvmBigint") {
    return GraphQLBigInt;
  }

  if (column.columnType === "PgEnumColumn") {
    const enumObject = (column as any)?.enum as
      | PgEnum<[string, ...string[]]>
      | undefined;
    if (enumObject === undefined) {
      throw new Error(
        `Internal error: Expected enum column "${getColumnTsName(column)}" to have an "enum" property`,
      );
    }
    const enumType = enumTypes[enumObject.enumName];
    if (enumType === undefined) {
      throw new Error(
        `Internal error: Expected to find a GraphQL enum named "${enumObject.enumName}"`,
      );
    }

    return enumType;
  }

  switch (column.dataType) {
    case "boolean":
      return GraphQLBoolean;
    case "json":
      return GraphQLJSON;
    case "date":
      return GraphQLString;
    case "string":
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

const innerType = (
  type: GraphQLOutputType,
): GraphQLScalarType | GraphQLEnumType => {
  if (type instanceof GraphQLScalarType || type instanceof GraphQLEnumType)
    return type;
  if (type instanceof GraphQLList || type instanceof GraphQLNonNull)
    return innerType(type.ofType);
  throw new Error(`Type ${type.toString()} is not implemented`);
};

async function executePluralQuery(
  table: TableRelationalConfig,
  drizzle: Drizzle<{ [key: string]: OnchainTable }>,
  args: PluralArgs,
  includeTotalCount: boolean,
  extraConditions: (SQL | undefined)[] = [],
) {
  const rawTable = drizzle._.fullSchema[table.tsName];
  const baseQuery = drizzle.query[table.tsName];
  if (rawTable === undefined || baseQuery === undefined)
    throw new Error(`Internal error: Table "${table.tsName}" not found in RQB`);

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

  if (after !== null && before !== null) {
    throw new Error("Cannot specify both before and after cursors.");
  }

  let startCursor = null;
  let endCursor = null;
  let hasPreviousPage = false;
  let hasNextPage = false;

  const totalCountPromise = includeTotalCount
    ? drizzle
        .select({ count: count() })
        .from(rawTable)
        .where(and(...whereConditions, ...extraConditions))
        .then((rows) => rows[0]?.count ?? null)
    : Promise.resolve(null);

  // Neither cursors are specified, apply the order conditions and execute.
  if (after === null && before === null) {
    const [rows, totalCount] = await Promise.all([
      baseQuery.findMany({
        where: and(...whereConditions, ...extraConditions),
        orderBy,
        limit: limit + 1,
      }),
      totalCountPromise,
    ]);

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
      totalCount,
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

    const [rows, totalCount] = await Promise.all([
      baseQuery.findMany({
        where: and(...whereConditions, cursorCondition, ...extraConditions),
        orderBy,
        limit: limit + 2,
      }),
      totalCountPromise,
    ]);

    if (rows.length === 0) {
      return {
        items: rows,
        totalCount,
        pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
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
      totalCount,
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
  const [rows, totalCount] = await Promise.all([
    baseQuery
      .findMany({
        where: and(...whereConditions, cursorCondition, ...extraConditions),
        orderBy: orderByReversed,
        limit: limit + 2,
      })
      .then((rows) => rows.reverse()),
    totalCountPromise,
  ]);

  if (rows.length === 0) {
    return {
      items: rows,
      totalCount,
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
    totalCount,
    pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
  };
}

const conditionSuffixes = {
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

const conditionSuffixesByLengthDesc = Object.values(conditionSuffixes)
  .flat()
  .sort((a, b) => b.length - a.length);

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

    // Search for a valid filter suffix, traversing the list from longest to shortest
    // to avoid ambiguity between cases like `_not_in` and `_in`.
    const conditionSuffix = conditionSuffixesByLengthDesc.find((s) =>
      whereKey.endsWith(s),
    );
    if (conditionSuffix === undefined) {
      throw new Error(
        `Invariant violation: Condition suffix not found for where key ${whereKey}`,
      );
    }

    // Remove the condition suffix and use the remaining string as the column name.
    const columnName = whereKey.slice(
      0,
      whereKey.length - conditionSuffix.length,
    );

    // Validate that the column name is present in the table.
    const column = columns[columnName];
    if (column === undefined) {
      throw new Error(
        `Invalid query: Where clause contains unknown column ${columnName}`,
      );
    }

    switch (conditionSuffix) {
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
      case "_not":
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
      case "_in":
        conditions.push(inArray(column, rawValue));
        break;
      case "_not_in":
        conditions.push(notInArray(column, rawValue));
        break;
      case "_has":
        conditions.push(arrayContains(column, [rawValue]));
        break;
      case "_not_has":
        conditions.push(not(arrayContains(column, [rawValue])));
        break;
      case "_gt":
        conditions.push(gt(column, rawValue));
        break;
      case "_lt":
        conditions.push(lt(column, rawValue));
        break;
      case "_gte":
        conditions.push(gte(column, rawValue));
        break;
      case "_lte":
        conditions.push(lte(column, rawValue));
        break;
      case "_contains":
        conditions.push(like(column, `%${rawValue}%`));
        break;
      case "_not_contains":
        conditions.push(notLike(column, `%${rawValue}%`));
        break;
      case "_starts_with":
        conditions.push(like(column, `${rawValue}%`));
        break;
      case "_ends_with":
        conditions.push(like(column, `%${rawValue}`));
        break;
      case "_not_starts_with":
        conditions.push(notLike(column, `${rawValue}%`));
        break;
      case "_not_ends_with":
        conditions.push(notLike(column, `%${rawValue}`));
        break;
      default:
        never(conditionSuffix);
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
    getColumnTsName(column),
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

          // The decoded row fragments should be valid `where` objects
          // which use the `eq` object shorthand for each primary key column.
          const idConditions = decodedRowFragments.map((decodedRowFragment) =>
            and(...buildWhereConditions(decodedRowFragment, table.columns)),
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

function getColumnTsName(column: Column) {
  const tableColumns = getTableColumns(column.table);
  return Object.entries(tableColumns).find(
    ([_, c]) => c.name === column.name,
  )![0];
}

/**
 * Returns `true` if the query includes a specific field.
 * Does not consider nested selections; only works one "layer" deep.
 */
function selectionIncludesField(
  info: GraphQLResolveInfo,
  fieldName: string,
): boolean {
  for (const fieldNode of info.fieldNodes) {
    for (const selection of fieldNode.selectionSet?.selections ?? []) {
      if (selection.kind === "Field" && selection.name.value === fieldName) {
        return true;
      }
    }
  }
  return false;
}
