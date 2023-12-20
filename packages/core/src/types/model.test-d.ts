import { test } from "vitest";

import { createSchema } from "@/schema/schema.js";
import type { RecoverTableType } from "@/schema/types.js";

import type { DatabaseModel } from "./model.js";

test("model", () => {
  const schema = createSchema((p) => ({
    name: p.createTable({
      id: p.bigint(),
    }),
  }));

  type t = RecoverTableType<{}, (typeof schema)["tables"]["name"]>;

  // @ts-ignore
  type _ = DatabaseModel<t>;
  //   ^?
});
