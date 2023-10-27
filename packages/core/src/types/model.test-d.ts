import { test } from "vitest";

import { createSchema, createTable, p } from "@/schema";
import { RecoverTableType } from "@/schema/types";

import { Model } from "..";

test("model", () => {
  const schema = createSchema({
    name: createTable({
      id: p.bigint(),
    }),
  });

  type t = RecoverTableType<(typeof schema)["tables"]["name"]>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _ = Model<t>;
  //   ^?
});
