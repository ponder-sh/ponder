import { expect, test } from "vitest";

import { p } from "./p";
import { createEnum, createSchema, createTable } from "./schema";

test("table", () => {
  const t = createTable({
    id: p.string(),
  });

  expect(t.id).toBeTruthy();
});

test("enum", () => {
  const e = createEnum(["ONE", "TWO"]);

  expect(e).toStrictEqual(["ONE", "TWO"]);
});

test("schema table", () => {
  const s = createSchema({
    t: createTable({
      id: p.string(),
      age: p.int({ optional: true }),
    }),
  });
  expect(s.enums).toStrictEqual({});
  expect(s.tables.t.age).toBeTruthy();
  expect(s.tables.t.id).toBeTruthy();
});

// test("create enum", () => {
//   createSchema({
//     enummm: createEnum(["ONE", "TWO", "THREE"]),
//     t: createTable({
//       id: column("string"),
//       age: column("enum:enummm"),
//     }),
//   });
// });

// test("references", () => {
//   createSchema({
//     Person: createTable({
//       id: column("string"),
//       age: column("int"),
//     }),
//     Dog: createTable({
//       id: column("string"),
//       ownerId: column("string", { references: "Person.id" }),
//     }),
//   });
// });

// test("virtual", () => {
//   createSchema({
//     Person: createTable({
//       id: column("string"),
//       age: column("int"),
//       pets: virtual("Dog.ownerId"),
//     }),
//     Dog: createTable({
//       id: column("string"),
//       ownerId: column("string", { references: "Person.id" }),
//     }),
//   });
// });
