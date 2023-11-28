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

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _ = DatabaseModel<t>;
  //   ^?
});
