import { expect, test } from "vitest";

import { buildEntityTypes } from "@/codegen/entity";
import * as p from "@/schema";

test("entity type codegen succeeds", () => {
  const output = buildEntityTypes(
    p.createSchema({
      name: p.createTable({
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
    p.createSchema({
      e: p.createEnum(["ONE", "TWO"]),
      name: p.createTable({
        id: p.bigint(),
        age: p.enum("e"),
      }),
    })
  );
  expect(output).toStrictEqual(`export type name = {
        id: bigint;age: "ONE" | "TWO";
        };`);
});
