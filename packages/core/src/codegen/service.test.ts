import { expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/entity";
import { createColumn, createEnum, createSchema } from "@/schema/schema";

test("entity type codegen succeeds", () => {
  const output = buildEntityTypes(
    createSchema({
      name: createColumn("id", "bigint").addColumn("age", "int"),
    })
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: number;
        };`);
});

test("enum type codegen succeeds", () => {
  const output = buildEntityTypes(
    createSchema({
      e: createEnum("ONE", "TWO"),
      name: createColumn("id", "bigint").addColumn("age", "enum:e"),
    })
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: "ONE" | "TWO";
        };`);
});
