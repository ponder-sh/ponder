import { RuleTester } from "@typescript-eslint/rule-tester";

import rule from "./rule";

const ruleTester = new RuleTester({
  parser: "@typescript-eslint/parser",
});

ruleTester.run("await-upsert", rule, {
  valid: [
    "await context.upsert({})",
    "await entity.upsert({})",
    "await Account.upsert({})",
  ],
  invalid: [
    {
      code: `context.upsert({})`,
      output: `await context.upsert({})`,
      errors: [
        {
          messageId: "awaitUpsert",
        },
      ],
    },
    {
      code: `entity.upsert({})`,
      output: `await entity.upsert({})`,
      errors: [
        {
          messageId: "awaitUpsert",
        },
      ],
    },
    {
      code: `Account.upsert({})`,
      output: `await Account.upsert({})`,
      errors: [
        {
          messageId: "awaitUpsert",
        },
      ],
    },
  ],
});
