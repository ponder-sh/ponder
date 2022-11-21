export const sqlOperatorsForFilterType: Record<
  string,
  | {
      operator: string;
      isList?: boolean;
      patternPrefix?: string;
      patternSuffix?: string;
    }
  | undefined
> = {
  // universal
  "": { operator: "=" },
  not: { operator: "!=" },
  // singular
  in: { operator: "in", isList: true },
  not_in: { operator: "not in", isList: true },
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
