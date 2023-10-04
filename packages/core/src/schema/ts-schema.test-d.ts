import { assertType, test } from "vitest";

import { createTable } from "./ts-schema";
import { RecoverColumnType, RecoverIDType } from "./ts-types";

test("id", () => {
  const table = createTable("table").addColumn("id", "string");

  type t = RecoverIDType<(typeof table)["table"]>;
  //   ^?

  assertType<t>({} as string);
});

test("column scalar", () => {
  const table = createTable("table").addColumn("id", "string");

  const column = table.table.columns;

  type t = RecoverColumnType<"id", (typeof column)["id"]>;
  //   ^?

  assertType<t>({} as { id: string });
});
