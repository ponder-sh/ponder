import { expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/entity";
import { createColumn, createSchema } from "@/schema/schema";

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
