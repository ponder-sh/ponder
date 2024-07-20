import { BuildError } from "@/common/errors.js";
import type { Schema } from "@/schema/common.js";
import {
  getTables,
  isEnumColumn,
  isJSONColumn,
  isListColumn,
  isManyColumn,
  isOneColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import {
  type GraphQLEnumType,
  type GraphQLInputFieldConfigMap,
  GraphQLInputObjectType,
} from "graphql";
import { GraphQLList } from "graphql";
import { SCALARS } from "./scalar.js";

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

export const buildEntityFilterTypes = ({
  schema,
  enumTypes,
}: { schema: Schema; enumTypes: Record<string, GraphQLEnumType> }) => {
  const entityFilterTypes: Record<string, GraphQLInputObjectType> = {};

  for (const [tableName, { table }] of Object.entries(getTables(schema))) {
    const filterType = new GraphQLInputObjectType({
      name: `${tableName}Filter`,
      fields: () => {
        const filterFields: GraphQLInputFieldConfigMap = {
          // Logical operators
          AND: { type: new GraphQLList(filterType) },
          OR: { type: new GraphQLList(filterType) },
        };

        Object.entries(table).forEach(([columnName, column]) => {
          // Note: Only include non-virtual columns in plural fields
          if (isOneColumn(column)) return;
          if (isManyColumn(column)) return;
          if (isJSONColumn(column)) return;

          const type = isEnumColumn(column)
            ? enumTypes[column[" enum"]]!
            : SCALARS[column[" scalar"]];

          if (isListColumn(column)) {
            // List fields => universal, plural
            filterOperators.universal.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type: new GraphQLList(type),
              };
            });

            filterOperators.plural.forEach((suffix) => {
              filterFields[`${columnName}${suffix}`] = {
                type,
              };
            });
          } else {
            // Scalar fields => universal, singular, numeric OR string depending on base type
            // Note: Booleans => universal and singular only.
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

            if (
              (isScalarColumn(column) || isReferenceColumn(column)) &&
              ["int", "bigint", "float", "hex"].includes(column[" scalar"])
            ) {
              filterOperators.numeric.forEach((suffix) => {
                filterFields[`${columnName}${suffix}`] = {
                  type: type,
                };
              });
            }

            if (
              (isScalarColumn(column) || isReferenceColumn(column)) &&
              "string" === column[" scalar"]
            ) {
              filterOperators.string.forEach((suffix) => {
                filterFields[`${columnName}${suffix}`] = {
                  type: type,
                };
              });
            }
          }
        });

        return filterFields;
      },
    });

    entityFilterTypes[tableName] = filterType;
  }

  return { entityFilterTypes };
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

export function buildWhereObject(where: Record<string, any>) {
  const whereObject: Record<string, any> = {};

  for (const [whereKey, rawValue] of Object.entries(where)) {
    // Handle the `and` and `or` operators.
    if (whereKey === "AND" || whereKey === "OR") {
      if (!Array.isArray(rawValue)) {
        throw new BuildError(
          `Invalid query: Expected an array for the ${whereKey} operator. Got: ${rawValue}`,
        );
      }

      whereObject[whereKey] = rawValue.map(buildWhereObject);
      continue;
    }

    const [fieldName, condition_] = whereKey.split(/_(.*)/s);
    // This is a hack to handle the "" operator, which the regex above doesn't handle
    const condition = (
      condition_ === undefined ? "" : condition_
    ) as keyof typeof graphqlFilterToStoreCondition;

    const storeCondition = graphqlFilterToStoreCondition[condition];
    if (!storeCondition) {
      throw new BuildError(
        `Invalid query: Unknown where condition: ${fieldName}_${condition}`,
      );
    }

    whereObject[fieldName!] ||= {};
    whereObject[fieldName!][storeCondition] = rawValue;
  }

  return whereObject;
}
