import { StoreError } from "@/common/errors.js";
import type { Schema } from "@/schema/types.js";
import { isBaseColumn, isEnumColumn } from "@/schema/utils.js";
import type {
  ComparisonOperatorExpression,
  ExpressionBuilder,
  ExpressionWrapper,
} from "kysely";
import { encodeValue } from "./encoding.js";

const filterValidityMap = {
  boolean: {
    singular: ["equals", "not", "in", "notIn"],
    list: ["equals", "not", "has", "notHas"],
  },
  string: {
    singular: [
      "equals",
      "not",
      "in",
      "notIn",
      "contains",
      "notContains",
      "startsWith",
      "notStartsWith",
      "endsWith",
      "notEndsWith",
    ],
    list: ["equals", "not", "has", "notHas"],
  },
  hex: {
    singular: ["equals", "not", "in", "notIn", "gt", "lt", "gte", "lte"],
    list: ["equals", "not", "has", "notHas"],
  },
  int: {
    singular: ["equals", "not", "in", "notIn", "gt", "lt", "gte", "lte"],
    list: ["equals", "not", "has", "notHas"],
  },
  bigint: {
    singular: ["equals", "not", "in", "notIn", "gt", "lt", "gte", "lte"],
    list: ["equals", "not", "has", "notHas"],
  },
  float: {
    singular: ["equals", "not", "in", "notIn", "gt", "lt", "gte", "lte"],
    list: ["equals", "not", "has", "notHas"],
  },
};

const filterEncodingMap: {
  [condition: string]: (
    value: any,
    encode: (v: any) => any,
  ) => [comparator: ComparisonOperatorExpression, value: any];
} = {
  // Universal
  equals: (value, encode) =>
    value === null ? ["is", null] : ["=", encode(value)],
  not: (value, encode) =>
    value === null ? ["is not", null] : ["!=", encode(value)],
  // Singular
  in: (value, encode) => ["in", value.map(encode)],
  notIn: (value, encode) => ["not in", value.map(encode)],
  // Plural/list
  has: (value, encode) => ["like", `%${encode(value)}%`],
  notHas: (value, encode) => ["not like", `%${encode(value)}%`],
  // Numeric
  gt: (value, encode) => [">", encode(value)],
  lt: (value, encode) => ["<", encode(value)],
  gte: (value, encode) => [">=", encode(value)],
  lte: (value, encode) => ["<=", encode(value)],
  // String
  contains: (value, encode) => ["like", `%${encode(value)}%`],
  notContains: (value, encode) => ["not like", `%${encode(value)}%`],
  startsWith: (value, encode) => ["like", `${encode(value)}%`],
  notStartsWith: (value, encode) => ["not like", `${encode(value)}%`],
  endsWith: (value, encode) => ["like", `%${encode(value)}`],
  notEndsWith: (value, encode) => ["not like", `%${encode(value)}`],
} as const;

export function buildWhereConditions({
  eb,
  where,
  table,
  encoding,
}: {
  eb: ExpressionBuilder<any, string>;
  where: Record<string, any>;
  table: Schema["tables"][keyof Schema["tables"]];
  encoding: "sqlite" | "postgres";
}) {
  const exprs: ExpressionWrapper<any, string, any>[] = [];

  for (const [columnName, rhs] of Object.entries(where)) {
    if (columnName === "AND" || columnName === "OR") {
      if (!Array.isArray(rhs)) {
        throw new StoreError(
          `Invalid filter. Expected an array for logical operator '${columnName}', got '${rhs}'.`,
        );
      }

      const nestedExprs = rhs.map((nestedWhere) =>
        buildWhereConditions({ eb, where: nestedWhere, table, encoding }),
      );

      exprs.push(eb[columnName === "AND" ? "and" : "or"](nestedExprs));
      continue;
    }

    const column = table[columnName];

    if (!column) {
      throw new StoreError(
        `Invalid filter. Column does not exist. Got '${columnName}', expected one of [${Object.keys(
          table,
        )
          .filter((key) => isBaseColumn(table[key]) || isEnumColumn(table[key]))
          .map((c) => `'${c}'`)
          .join(", ")}]`,
      );
    }

    if (column._type === "m" || column._type === "o") {
      throw new StoreError(
        `Invalid filter. Cannot filter on virtual column '${columnName}'.`,
      );
    }

    // Handle the shortcut case for `equals`, e.g. { user: "abc" }.
    const conditionsForColumn =
      Array.isArray(rhs) || typeof rhs !== "object" ? { equals: rhs } : rhs;

    for (const [condition, value] of Object.entries(conditionsForColumn)) {
      const filterType = column._type === "e" ? "string" : column.type;

      const allowedConditions =
        filterValidityMap[filterType]?.[column.list ? "list" : "singular"];
      if (!allowedConditions.includes(condition)) {
        throw new StoreError(
          `Invalid filter condition for column '${columnName}'. Got '${condition}', expected one of [${allowedConditions
            .map((c) => `'${c}'`)
            .join(", ")}]`,
        );
      }

      const filterEncodingFn = filterEncodingMap[condition];

      // Handle special case for list column types `has` and `notHas`.
      // We need to use the singular encoding function for the arguments.
      const encode =
        column.list && (condition === "has" || condition === "notHas")
          ? (v: any) => encodeValue(v, { ...column, list: false }, encoding)
          : (v: any) => encodeValue(v, column, encoding);

      const [comparator, encodedValue] = filterEncodingFn(value, encode);
      exprs.push(eb.eb(columnName, comparator, encodedValue));
    }
  }

  return eb.and(exprs);
}
