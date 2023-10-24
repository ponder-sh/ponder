import { column, createSchema, table, virtual } from "@ponder/core";

export const schema = createSchema({
  SetupEntity: table({
    id: column("string"),
  }),
  Account: table({
    id: column("string"),
    tokens: virtual("Token.ownerId"),
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
