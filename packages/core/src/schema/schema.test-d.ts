import { assertType, test } from "vitest";

import { p } from "./p";
import { createEnum, createSchema, createTable } from "./schema";
import {
  BaseColumn,
  FilterEnums,
  FilterTables,
  RecoverSchemaType,
  RecoverTableType,
  Schema,
} from "./types";

test("table", () => {
  const a = createTable({
    id: p.string(),
    age: p.int(),
  });

  type t = RecoverTableType<typeof a>;
  //   ^?

  assertType<t>({} as { id: string; age: number });
});

test("table optional", () => {
  const t = createTable({
    id: p.string(),
    age: p.int({ optional: true }),
  });

  type t = RecoverTableType<typeof t>;
  //   ^?

  assertType<t>({} as { id: string; age?: number });
});

test("filter enums", () => {
  const a = {
    //  ^?
    t: createTable({
      id: p.string(),
    }),
    e: createEnum(["ONE", "TWO"] as const),
  };

  type t = FilterEnums<typeof a>;
  //   ^?

  assertType<t>({} as { e: ["ONE", "TWO"] });
});

test("filter tables", () => {
  const a = {
    //  ^?
    t: createTable({
      id: p.string(),
    }),
    e: createEnum(["ONE", "TWO"] as const),
  };

  type t = FilterTables<typeof a>;
  //   ^?

  assertType<t>({} as { t: { id: BaseColumn<"string", never, false, false> } });
});

test("schema", () => {
  const s = createSchema({
    //  ^?
    t: createTable({
      id: p.string(),
    }),
  });

  assertType<Schema>(s);

  type t = RecoverSchemaType<typeof s>;
  //   ^?

  assertType<t>({} as { t: { id: string } });
});
