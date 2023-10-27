import { expect, test } from "vitest";

import { p } from "./p";
import { createTable } from "./schema";

test("table", () => {
  const t = createTable({
    id: p.string(),
  });

  expect(t.isEnum).toBe(false);
  expect(t.table.id).toBeTruthy();
});

// test("create schema", () => {
//   createSchema({
//     t: createTable({
//       id: column("string"),
//       age: column("int", { optional: true }),
//     }),
//   });
// });

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
