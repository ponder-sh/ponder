import { test } from "vitest";

import * as p from "@/schema/index.js";
import type { RecoverTableType } from "@/schema/types.js";

import type { Model } from "./model.js";

test("model", () => {
  const schema = p.createSchema({
    name: p.createTable({
      id: p.bigint(),
    }),
  });

  type t = RecoverTableType<{}, (typeof schema)["tables"]["name"]>;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _ = Model<t>;
  //   ^?
});
