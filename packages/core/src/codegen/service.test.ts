import { expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/entity";
import { createEnum, createSchema, createTable, p } from "@/schema";

test("entity type codegen succeeds", () => {
  const output = buildEntityTypes(
    createSchema({
      name: createTable({
        id: p.bigint(),
        age: p.int(),
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
      e: createEnum(["ONE", "TWO"]),
      name: createTable({
        id: p.bigint(),
        age: p.enum("e"),
      }),
    })
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: "ONE" | "TWO";
        };`);
});
