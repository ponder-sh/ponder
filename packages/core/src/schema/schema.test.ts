import { test } from "vitest";

import { createColumn, createSchema } from "./schema";

// This may be in a museum one day
// We like this one!!
// const schema = createSchema([
//   createTable("share")
//     .addColumn("id", "string")
//     .addColumn("name", "string")
//     .addColumn(
//       "usernames",
//       "string",
//       { optional: true, list: true }
//     ),
//   createTable("account")
//     .addColumn("id", "string")
//     .addColumn("name", "string")
//     .addColumn("shareId", "string", { references: "share.id" }),
// ]);

// const schema = createSchema({
//   share: createColumn("id", "string")
//     .addColumn("name", "string")
//     .addColumn("usernames", "string", { optional: true, list: true }),
//   account: createColumn("id", "string")
//     .addColumn("name", "string")
//     .addColumn("shareId", "string", { references: "share.id" }),
// });

// const schema = createSchema({
//   share: [
//     createColumn("id", "string"),
//     createColumn("name", "string"),
//     createColumn("usernames", "string", { optional: true, list: true }),
//   ],
//   account: [
//     createColumn("id", "string"),
//     createColumn("name", "string"),
//     createColumn("shareId", "string", { references: "share.id" }),
//   ],
// });

test("create schema", () => {
  createSchema({
    name: createColumn("id", "bigint").addColumn("age", "boolean"),
  });
});

test("references", () => {
  createSchema({
    Person: createColumn("id", "string").addColumn("age", "int"),
    Dog: createColumn("id", "string").addColumn("owner", "string", {
      references: "Person.id",
    }),
  });
});
