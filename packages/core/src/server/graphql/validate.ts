import type { Prettify } from "@/types/utils.js";
import { maxAliasesRule } from "@escape.tech/graphql-armor-max-aliases";
import { maxDepthRule } from "@escape.tech/graphql-armor-max-depth";
import type { ValidationRule } from "graphql";

type MaxDepthRuleOptions = Prettify<Parameters<typeof maxDepthRule>[0]>;

export function createMaxDepthRule(args: MaxDepthRuleOptions = {}) {
  const rule: ValidationRule = (context) =>
    maxDepthRule({
      ...args,
      onReject: [(_, error) => context.reportError(error)],
      propagateOnRejection: false,
    })(context);
  return rule;
}

type MaxAliasesRuleOptions = Prettify<Parameters<typeof maxAliasesRule>[0]>;

export function createMaxAliasesRule(
  args: MaxAliasesRuleOptions = { allowList: [] },
) {
  const rule: ValidationRule = (context) =>
    maxAliasesRule({
      ...args,
      onReject: [(_, error) => context.reportError(error)],
      propagateOnRejection: false,
    })(context);
  return rule;
}
