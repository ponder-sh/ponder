import { test } from "vitest";

import { createSchema, createTable } from "@/schema/schema";
import { RecoverTableType } from "@/schema/types";

import { Model } from "..";

test("model", () => {
  const schema = createSchema([createTable("name").addColumn("id", "bigint")]);

  type t = RecoverTableType<(typeof schema)["entities"][0]>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _ = Model<t["name"]>;
  //   ^?
});
