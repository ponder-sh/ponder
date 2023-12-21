import type { ComparisonOperatorExpression } from "kysely";

import { encodeAsText } from "@/utils/encoding.js";

import type { OrderByInput, Table, WhereInput } from "../store.js";

export const sqlOperatorsByCondition = {
  // universal
  equals: { operator: "=", patternPrefix: undefined, patternSuffix: undefined },
  not: { operator: "!=", patternPrefix: undefined, patternSuffix: undefined },
  // singular
  in: { operator: "in", patternPrefix: undefined, patternSuffix: undefined },
  notIn: {
    operator: "not in",
    patternPrefix: undefined,
    patternSuffix: undefined,
  },
  // plural
  has: { operator: "like", patternPrefix: "%", patternSuffix: "%" },
  notHas: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  // numeric
  gt: { operator: ">", patternPrefix: undefined, patternSuffix: undefined },
  lt: { operator: "<", patternPrefix: undefined, patternSuffix: undefined },
  gte: { operator: ">=", patternPrefix: undefined, patternSuffix: undefined },
  lte: { operator: "<=", patternPrefix: undefined, patternSuffix: undefined },
  // string
  contains: {
    operator: "like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  notContains: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  startsWith: {
    operator: "like",
    patternPrefix: undefined,
    patternSuffix: "%",
  },
  endsWith: { operator: "like", patternPrefix: "%", patternSuffix: undefined },
  notStartsWith: {
    operator: "not like",
    patternPrefix: undefined,
    patternSuffix: "%",
  },
  notEndsWith: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: undefined,
  },
} as const;

export type ConditionName = keyof typeof sqlOperatorsByCondition;

export function buildSqlWhereConditions({
  where,
  encodeBigInts,
}: {
  where: WhereInput<Table>;
  encodeBigInts: boolean;
}) {
  // If the where clause has multiple conditions, they are combined using AND.
  // TODO: support complex filters with OR, NOT, and arbitrary nesting.

  const conditions: [
    fieldName: string,
    operator: ComparisonOperatorExpression,
    parameter: any,
  ][] = [];

  for (const [fieldName, rhs] of Object.entries(where)) {
    // If the rhs is an object, assume its a complex condition (not a simple equality value).
    if (typeof rhs === "object" && !Array.isArray(rhs)) {
      for (const [condition_, value] of Object.entries(rhs)) {
        const condition = validateConditionName(condition_);
        const { operator, parameter } = getOperatorAndParameter({
          condition,
          value,
          encodeBigInts,
        });
        conditions.push([fieldName, operator, parameter]);
      }
    } else {
      // Otherwise, assume it's a simple equality value.
      const { operator, parameter } = getOperatorAndParameter({
        condition: "equals",
        value: rhs,
        encodeBigInts,
      });
      conditions.push([fieldName, operator, parameter]);
    }
  }

  return conditions;
}

function validateConditionName(condition: string) {
  if (Object.keys(sqlOperatorsByCondition).includes(condition)) {
    return condition as ConditionName;
  } else {
    throw new Error(`Invalid filter condition name: ${condition}`);
  }
}

function getOperatorAndParameter({
  condition,
  value,
  encodeBigInts,
}: {
  condition: ConditionName;
  value: unknown;
  encodeBigInts: boolean;
}) {
  const operators = sqlOperatorsByCondition[condition];

  const { operator, patternPrefix, patternSuffix } = operators;

  if (value === null || value === undefined) {
    return {
      operator:
        operator === "="
          ? ("is" as const)
          : operator === "!="
            ? ("is not" as const)
            : operator,
      parameter: null,
    };
  }

  if (Array.isArray(value)) {
    // Handle scalar list equals.
    if (condition === "equals" || condition === "not") {
      return { operator, parameter: JSON.stringify(value) };
    }

    // Handle scalar list contains.
    return {
      operator,
      parameter: value.map((v) => {
        if (typeof v === "boolean") {
          return v ? 1 : 0;
        } else if (typeof v === "bigint") {
          return encodeAsText(v);
        } else {
          return v;
        }
      }),
    };
  }

  if (typeof value === "boolean") {
    return { operator, parameter: value ? 1 : 0 };
  }

  if (typeof value === "bigint") {
    return { operator, parameter: encodeBigInts ? encodeAsText(value) : value };
  }

  // Handle strings and numbers.
  let finalValue = value;
  if (patternPrefix) finalValue = `${patternPrefix}${finalValue}`;
  if (patternSuffix) finalValue = `${finalValue}${patternSuffix}`;

  return { operator, parameter: finalValue };
}

export function buildSqlOrderByConditions({
  orderBy,
}: {
  orderBy: OrderByInput<Table>;
}) {
  const conditions: [fieldName: string, direction: "asc" | "desc"][] = [];

  for (const orderBy_ of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    const entries = Object.entries(orderBy_);
    if (entries.length !== 1) {
      throw new Error("Invalid sort condition: Must have exactly one property");
    }
    const [fieldName, direction] = entries[0];
    if (direction) {
      conditions.push([fieldName, direction]);
    }
  }

  return conditions;
}
