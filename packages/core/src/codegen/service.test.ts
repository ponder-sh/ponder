import { expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/entity";

import { createSchema, createTable } from "..";

test("entity type codegen succeeds", () => {
  const output = buildEntityTypes(
    createSchema([
      createTable("name").addColumn("id", "bigint").addColumn("age", "number"),
    ]).entities
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: number;
        };`);
});
