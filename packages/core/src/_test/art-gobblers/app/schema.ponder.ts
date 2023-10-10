import { createSchema, createTable } from "@ponder/core";

export const schema = createSchema([
  createTable("SetupEntity").addColumn("id", "string"),
  createTable("Account").addColumn("id", "string"),
  createTable("Token")
    .addColumn("id", "bigint")
    .addColumn("claimedBy", "string", {
      references: "Account.id",
      optional: true,
    })
    .addColumn("owner", "string", { references: "Account.id" }),
]);
