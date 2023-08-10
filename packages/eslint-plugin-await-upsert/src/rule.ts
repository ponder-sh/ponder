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
      if (callee.type !== "MemberExpression") return;

      const { object } = callee;

      if (object.type !== "Identifier") return;
      if (object.name !== "context") return;

      // 2 levels up is the AwaitExpression
      const ancestor = context.getAncestors()[2];

      if (!ancestor || ancestor.type !== "AwaitExpression") {
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
