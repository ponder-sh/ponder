import type { InferSchemaType } from "@/schema/infer.js";
import { createSchema } from "@/schema/schema.js";
import { test } from "vitest";
import type { DatabaseModel } from "./model.js";

test("model", () => {
  const schema = createSchema((p) => ({
    name: p.createTable({
      id: p.bigint(),
    }),
  }));

  type s = InferSchemaType<typeof schema>;

  // @ts-ignore
  type _ = DatabaseModel<s["name"]>;
  //   ^?
});
