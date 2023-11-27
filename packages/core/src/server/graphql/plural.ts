import type {
  GraphQLEnumType,
  GraphQLInputFieldConfigMap,
  GraphQLObjectType,
} from "graphql";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
} from "graphql";

import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";

import type { Context, Source } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

type PluralArgs = {
  timestamp?: number;
  where?: { [key: string]: number | string };
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};
type PluralResolver = GraphQLFieldResolver<Source, Context, PluralArgs>;

const operators = {
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
};

export const buildPluralField = ({
  tableName,
  table,
  entityGqlType,
  enumGqlTypes,
}: {
  tableName: string;
  table: Schema["tables"][string];
  entityGqlType: GraphQLObjectType<Source, Context>;
  enumGqlTypes: Record<string, GraphQLEnumType>;
}): GraphQLFieldConfig<Source, Context> => {
  const filterFields: GraphQLInputFieldConfigMap = {};

  Object.entries(table).forEach(([columnName, column]) => {
    // Note: Only include non-virtual columns in plural fields
    if (isOneColumn(column)) return;
    if (isManyColumn(column)) return;

    const type = isEnumColumn(column)
      ? enumGqlTypes[column.type]
      : tsTypeToGqlScalar[column.type];

    if (column.list) {
      // List fields => universal, plural
      operators.universal.forEach((suffix) => {
        filterFields[`${columnName}${suffix}`] = {
          type: new GraphQLList(type),
        };
      });

      operators.plural.forEach((suffix) => {
        filterFields[`${columnName}${suffix}`] = {
          type: type,
        };
      });
    } else {
      // Scalar fields => universal, singular, numeric OR string depending on base type
      // Note: Booleans => universal and singular only.
      operators.universal.forEach((suffix) => {
        filterFields[`${columnName}${suffix}`] = {
          type: type,
        };
      });

      operators.singular.forEach((suffix) => {
        filterFields[`${columnName}${suffix}`] = {
          type: new GraphQLList(type),
        };
      });

      if (["int", "bigint", "float"].includes(column.type)) {
        operators.numeric.forEach((suffix) => {
          filterFields[`${columnName}${suffix}`] = {
            type: type,
          };
        });
      }

      if (["string", "bytes"].includes(column.type)) {
        operators.string.forEach((suffix) => {
          filterFields[`${columnName}${suffix}`] = {
            type: type,
          };
        });
      }
    }
  });

  const filterType = new GraphQLInputObjectType({
    name: `${tableName}Filter`,
    fields: filterFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { store } = context;

    const { timestamp, where, skip, first, orderBy, orderDirection } = args;

    return await store.findMany({
      tableName: tableName,
      timestamp: timestamp ? timestamp : undefined,
      where: where ? buildWhereObject({ where }) : undefined,
      skip: skip,
      take: first,
      orderBy: orderBy ? { [orderBy]: orderDirection || "asc" } : undefined,
    });
  };

  return {
    type: new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(entityGqlType)),
    ),
    args: {
      skip: { type: GraphQLInt, defaultValue: 0 },
      first: { type: GraphQLInt, defaultValue: 100 },
      orderBy: { type: GraphQLString, defaultValue: "id" },
      orderDirection: { type: GraphQLString, defaultValue: "asc" },
      where: { type: filterType },
      timestamp: { type: GraphQLInt },
    },
    resolve: resolver,
  };
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
