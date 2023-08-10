import { TSESLint } from "@typescript-eslint/utils";

import rule from "./rule";

export const rules = {
  "await-upsert": rule,
} satisfies Record<string, TSESLint.RuleModule<string, Array<unknown>>>;
