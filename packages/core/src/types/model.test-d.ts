import { test } from "vitest";

import { createColumn, createSchema } from "@/schema/schema";
import { RecoverTableType } from "@/schema/types";

import { Model } from "..";

test("model", () => {
  const schema = createSchema({
    name: createColumn("id", "bigint"),
  });

  type t = RecoverTableType<(typeof schema)["name"]>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _ = Model<t>;
  //   ^?
});
