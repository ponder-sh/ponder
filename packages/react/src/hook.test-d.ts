import { sql } from "@ponder/client";
import { test } from "vitest";
import { usePonderQuery } from "./hook.js";

test("usePonderQuery", () => {
  const use = usePonderQuery({
    queryFn: (db) => db.execute<{ a: number; b: string }>(sql``),
    select: (data) => data.map((row) => row.a),
  });

  if (use.isSuccess) {
    // @ts-ignore
    type _ = typeof use.data;
    //   ^?
  }
});
