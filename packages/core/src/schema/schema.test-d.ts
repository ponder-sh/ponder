import { assertType, test } from "vitest";

import { p } from "./p";
import { createSchema, createTable } from "./schema";
import { RecoverTableType, Schema } from "./types";

test("table", () => {
  const a = createTable({
    id: p.string(),
    age: p.int(),
  });

  type t = RecoverTableType<(typeof a)["table"]>;
  //   ^?

  assertType<t>({} as { id: string; age: number });
});

test("table optional", () => {
  const t = createTable({
    id: p.string(),
    age: p.int({ optional: true }),
  });

  type t = RecoverTableType<(typeof t)["table"]>;
  //   ^?

  assertType<t>({} as { id: string; age?: number });
});

test("schema", () => {
  const s = createSchema({
    //  ^?
    t: createTable({
      id: p.string(),
    }),
  });

  assertType<Schema>(s);
});
