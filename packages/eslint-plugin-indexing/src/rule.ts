import { TSESLint } from "@typescript-eslint/utils";

type MessageIds = "awaitUpsert";

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "suggestion",
    messages: {
      awaitUpsert: "Add await to upsert operation",
    },
    fixable: "code",
    schema: [],
  },
  create: (context) => ({
    CallExpression: (node) => {
      const { callee } = node;

      // Check if the callee is a member expression aka a function call
      // e.g. context.upsert({})
      if (callee.type !== "MemberExpression") return;
      if (callee.property.type !== "Identifier") return;
      if (callee.property.name !== "upsert") return;

      // check if the call is preceded by an await expression
      const ancestor = context
        .getAncestors()
        .find((ancestor) => ancestor.type === "AwaitExpression");

      if (!ancestor) {
        context.report({
          node,
          messageId: "awaitUpsert",
          fix: (fixer) => {
            return fixer.insertTextBefore(node, "await ");
          },
        });
      }
    },
  }),
};

export default rule;
