import { BaseError } from "@/errors/base";
import { Prettify } from "@/types/utils";
import { intToBlob } from "@/utils/encode";

import type { ModelFilter, ModelInstance } from "./store";

export const MAX_INTEGER = 2_147_483_647 as const;

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

export type ConditionName = Prettify<
  | "equals"
  | "not"
  | "in"
  | "notIn"
  | "has"
  | "notHas"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "startsWith"
  | "notStartsWith"
  | "endsWith"
  | "notEndsWith"
>;

export function getWhereOperatorAndParameter({
  condition,
  value,
}: {
  condition: ConditionName;
  value: unknown;
}) {
  const operators = sqlOperatorsByCondition[condition];
  if (!operators) throw new BaseError(`Invalid condition: ${condition}`);

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
          return intToBlob(v);
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
    return { operator, parameter: intToBlob(value) };
  }

  // Handle strings and numbers.
  let finalValue = value;
  if (patternPrefix) finalValue = `${patternPrefix}${finalValue}`;
  if (patternSuffix) finalValue = `${finalValue}${patternSuffix}`;

  return { operator, parameter: finalValue };
}

export function formatModelFieldValue({ value }: { value: unknown }) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  } else if (typeof value === "bigint") {
    return intToBlob(value);
  } else if (typeof value === "undefined") {
    return null;
  } else if (Array.isArray(value)) {
    if (typeof value[0] === "bigint") {
      return JSON.stringify(value.map(String));
    } else {
      return JSON.stringify(value);
    }
  } else {
    return value as string | number | null;
  }
}

export function formatModelInstance({
  id,
  data,
}: {
  id: string | number | bigint;
  data: Partial<Omit<ModelInstance, "id">>;
}) {
  const instance: { [key: string]: string | number | null | Buffer } = {};

  instance["id"] = formatModelFieldValue({ value: id });

  Object.entries(data).forEach(([key, value]) => {
    instance[key] = formatModelFieldValue({ value });
  });

  return instance;
}

const MAX_LIMIT = 1000;
const MAX_SKIP = 5000;

export function validateFilter(filter: ModelFilter = {}): ModelFilter {
  if (filter.first && filter.first > MAX_LIMIT) {
    throw new BaseError("Cannot query more than 1000 rows.");
  }

  if (filter.skip && filter.skip > MAX_SKIP) {
    throw new BaseError("Cannot skip more than 5000 rows.");
  }

  return filter;
}
