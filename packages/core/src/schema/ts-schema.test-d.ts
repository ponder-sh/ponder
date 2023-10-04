import { assertType, test } from "vitest";

import { createTable } from "./ts-schema";
import { RecoverColumnType } from "./ts-types";

test("column scalar", () => {
  const table = createTable("table").addColumn("id", "string");

  const column = table.table.columns;

  type t = RecoverColumnType<"id", (typeof column)["id"]>;
  //   ^?

  assertType<t>({} as { id: string });
});
