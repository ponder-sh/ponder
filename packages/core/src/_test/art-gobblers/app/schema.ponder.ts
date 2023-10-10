import { createColumn, createSchema } from "@ponder/core";

export const schema = createSchema({
  SetupEntity: createColumn("id", "string"),
  Account: createColumn("id", "string"),
  Token: createColumn("id", "bigint")
    .addColumn("claimedBy", "string", {
      references: "Account.id",
      optional: true,
    })
    .addColumn("owner", "string", { references: "Account.id" }),
});
