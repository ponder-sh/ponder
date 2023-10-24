import { column, createSchema, table } from "@ponder/core";

export const schema = createSchema({
  SetupEntity: table({
    id: column("string"),
  }),
  Account: table({
    id: column("string"),
  }),

  Token: table({
    id: column("bigint"),
    claimedById: column("string", {
      references: "Account.id",
      optional: true,
    }),
    ownerId: column("string", { references: "Account.id" }),
  }),
});
