export const sqlSymbolsForFilterType: Record<
  string,
  | {
      operator: string;
      patternPrefix?: string;
      patternSuffix?: string;
    }
  | undefined
> = {
  // universal
  "": { operator: "=" },
  not: { operator: "!=" },
  // singular
  in: { operator: "in" },
  not_in: { operator: "not in" },
  // plural
  contains: { operator: "like", patternPrefix: "%", patternSuffix: "%" },
  contains_nocase: {
    operator: "like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  not_contains: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  not_contains_nocase: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  // numeric
  gt: { operator: ">" },
  lt: { operator: "<" },
  gte: { operator: ">=" },
  lte: { operator: "<=" },
  // string
  starts_with: { operator: "like", patternSuffix: "%" },
  starts_with_nocase: { operator: "like", patternSuffix: "%" },
  ends_with: { operator: "like", patternPrefix: "%" },
  ends_with_nocase: { operator: "like", patternPrefix: "%" },
  not_starts_with: { operator: "not like", patternSuffix: "%" },
  not_starts_with_nocase: { operator: "not like", patternSuffix: "%" },
  not_ends_with: { operator: "not like", patternSuffix: "%" },
  not_ends_with_nocase: { operator: "not like", patternSuffix: "%" },
};

// Accepts an instance being passed to `insert`, `update`, or `upsert` and
// returns a list of column names and values to be persisted.
export const getWhereValue = (
  value:
    | boolean
    | number
    | string
    | (number | string | boolean)[]
    | undefined
    | null,
  sqlSymbols: {
    operator: string;
    patternPrefix?: string;
    patternSuffix?: string;
  }
): string => {
  const { operator, patternPrefix, patternSuffix } = sqlSymbols;

  if (value === null) {
    if (["=", "!="].includes(operator)) {
      return `${operator === "=" ? "IS" : "IS NOT"} ${value}`;
    } else {
      return `${operator} ${value}`;
    }
  }

  if (typeof value === "object" && value.length) {
    return `${operator} (${value
      .map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : `${v}`))
      .join(",")})`;
  }

  if (typeof value === "boolean") {
    return `${operator} ${value ? 1 : 0}`;
  }

  let finalValue = value;
  if (patternPrefix) finalValue = `${patternPrefix}${finalValue}`;
  if (patternSuffix) finalValue = `${finalValue}${patternSuffix}`;

  return `${operator} '${finalValue}'`;
};

// Accepts an instance being passed to `insert`, `update`, or `upsert` and
// returns a list of column names and values to be persisted.
export const getColumnStatements = (instance: Record<string, unknown>) => {
  return Object.entries(instance)
    .map(([fieldName, value]) => {
      let persistedValue: number | string | null;
      if (typeof value === "boolean") {
        persistedValue = value ? 1 : 0;
      } else if (typeof value === "undefined") {
        persistedValue = null;
      } else {
        persistedValue = `'${value}'`;
      }

      return {
        column: `"${fieldName}"`,
        value: persistedValue,
      };
    })
    .filter(({ value }) => value !== null);
};
