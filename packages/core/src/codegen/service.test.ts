import { expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/entity";
import { column, createSchema, enumerable, table } from "@/schema/schema";

test("entity type codegen succeeds", () => {
  const output = buildEntityTypes(
    createSchema({
      name: table({
        id: column("bigint"),
        age: column("int"),
      }),
    })
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: number;
        };`);
});

test("enum type codegen succeeds", () => {
  const output = buildEntityTypes(
    createSchema({
      e: enumerable(["ONE", "TWO"]),
      name: table({
        id: column("bigint"),
        age: column("enum:e"),
      }),
    })
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: "ONE" | "TWO";
        };`);
});
