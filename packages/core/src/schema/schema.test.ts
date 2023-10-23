import { test } from "vitest";

import { column, createSchema, enumerable, table } from "./schema";

// We like this one!!
// const s = createSchema({
//   share: table({
//     id: column("string"),
//     name: column("string"),
//     usernames: column("string", { optional: true, list: true }),
//   }),
//   account: table({
//     id: column("string"),
//     name: column("string"),
//     shareId: column("string", { refernces: "share.id" }),
//   }),
// });

test("create schema", () => {
  createSchema({
    t: table({
      id: column("string"),
      age: column("int", { optional: true }),
    }),
  });
});

test("create enum", () => {
  createSchema({
    enummm: enumerable("ONE", "TWO", "THREE"),
    t: table({
      id: column("string"),
      age: column("enum:enummm"),
    }),
  });
});

test("references", () => {
  createSchema({
    Person: table({
      id: column("string"),
      age: column("int"),
    }),
    Dog: table({
      id: column("string"),
      ownerId: column("string", { references: "Person.id" }),
    }),
  });
});
