import { createSchema, createTable } from "@ponder/core";

export const schema = createSchema([
  createTable("EnsNft")
    .addColumn("id", "string")
    .addColumn("labelHash", "string")
    .addColumn("owner", "string", { references: "Account.id" })
    .addColumn("transferredAt", "int")
    .addColumn("stringArray", "string", { list: true })
    .addColumn("intArray", "int", { list: true }),
  createTable("Account")
    .addColumn("id", "string")
    .addColumn("lastActive", "int"),
]);
