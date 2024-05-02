import { assertType, test } from "vitest";
import { _enum, index, many, one, string } from "./columns.js";

test("base", () => {
  const c = string();
  //    ^?

  assertType<keyof typeof c>(
    {} as unknown as "optional" | "list" | "references",
  );
  assertType<Omit<typeof c, "optional" | "list" | "references">>(
    {} as unknown as {
      " type": "scalar";
      " scalar": "string";
      " optional": false;
      " list": false;
    },
  );
});

test("optional", () => {
  const c = string().optional();
  //    ^?

  assertType<keyof typeof c>({} as unknown as "list" | "references");
  assertType<Omit<typeof c, "list" | "references">>(
    {} as unknown as {
      " type": "scalar";
      " scalar": "string";
      " optional": true;
      " list": false;
    },
  );
});

test("list", () => {
  const c = string().list();
  //    ^?

  assertType<keyof typeof c>({} as unknown as "optional");
  assertType<Omit<typeof c, "optional">>(
    {} as unknown as {
      " type": "scalar";
      " scalar": "string";
      " optional": false;
      " list": true;
    },
  );
});

test("optional + list", () => {
  const c = string().optional().list();
  //    ^?

  assertType<Omit<typeof c, "optional">>(
    {} as unknown as {
      " type": "scalar";
      " scalar": "string";
      " optional": true;
      " list": true;
    },
  );
});

test("list + optional", () => {
  const c = string().list().optional();
  //    ^?

  assertType<Omit<typeof c, "optional">>(
    {} as unknown as {
      " type": "scalar";
      " scalar": "string";
      " optional": true;
      " list": true;
    },
  );
});

test("references", () => {
  const c = string().references("OtherTable.id");
  //    ^?

  assertType<keyof typeof c>({} as unknown as "optional");
  assertType<Omit<typeof c, "optional">>(
    {} as unknown as {
      " type": "reference";
      " scalar": "string";
      " optional": false;
      " reference": "OtherTable.id";
    },
  );
});

test("references + optional", () => {
  const c = string().references("OtherTable.id").optional();
  //    ^?

  assertType<Omit<typeof c, "optional">>(
    {} as unknown as {
      " type": "reference";
      " scalar": "string";
      " optional": true;
      " reference": "OtherTable.id";
    },
  );
});

test("optional + references", () => {
  const c = string().optional().references("OtherTable.id");
  //    ^?

  assertType<Omit<typeof c, "optional">>(
    {} as unknown as {
      " type": "reference";
      " scalar": "string";
      " optional": true;
      " reference": "OtherTable.id";
    },
  );
});

test("one", () => {
  const c = one("column");
  //    ^?

  assertType<typeof c>(
    {} as unknown as { " type": "one"; " reference": "column" },
  );
});

test("many", () => {
  const c = many("table.column");
  //    ^?

  assertType<typeof c>(
    {} as unknown as {
      " type": "many";
      " referenceTable": "table";
      " referenceColumn": "column";
    },
  );
});

test("enum", () => {
  const e = _enum("enum");
  //    ^?

  assertType<keyof typeof e>({} as unknown as "optional" | "list");
  assertType<Omit<typeof e, "optional" | "list">>(
    {} as unknown as {
      " type": "enum";
      " enum": "enum";
      " optional": false;
      " list": false;
    },
  );
});

test("enum optional", () => {
  const e = _enum("enum").optional();
  //    ^?

  assertType<keyof typeof e>({} as unknown as "list");
  assertType<Omit<typeof e, "list">>(
    {} as unknown as {
      " type": "enum";
      " enum": "enum";
      " optional": true;
      " list": false;
    },
  );
});

test("enum optional + list", () => {
  const e = _enum("enum").optional().list();
  //    ^?

  assertType<keyof typeof e>({} as unknown as never);
  assertType<typeof e>(
    {} as unknown as {
      " type": "enum";
      " enum": "enum";
      " optional": true;
      " list": true;
    },
  );
});

test("enum list + optional", () => {
  const e = _enum("enum").list().optional();
  //    ^?

  assertType<keyof typeof e>({} as unknown as never);
  assertType<typeof e>(
    {} as unknown as {
      " type": "enum";
      " enum": "enum";
      " optional": true;
      " list": true;
    },
  );
});

test("index", () => {
  const i = index(["column"]);
  //    ^?

  assertType<typeof i>(
    {} as unknown as {
      " type": "index";
      " column": readonly ["column"];
    },
  );
});
