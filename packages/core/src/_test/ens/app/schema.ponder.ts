import { createColumn, createSchema } from "@ponder/core";

export const schema = createSchema({
  EnsNft: createColumn("id", "string")
    .addColumn("labelHash", "string")
    .addColumn("owner", "string", { references: "Account.id" })
    .addColumn("transferredAt", "int")
    .addColumn("stringArray", "string", { list: true })
    .addColumn("intArray", "int", { list: true }),
  Account: createColumn("id", "string").addColumn("lastActive", "int"),
});
