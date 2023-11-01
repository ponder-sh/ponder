import { createSchema, createTable, p } from "../../../../dist";

export const schema = createSchema({
  SetupEntity: createTable({
    id: p.string(),
  }),
  Account: createTable({
    id: p.string(),
    tokens: p.virtual("Token.ownerId"),
  }),

  Token: createTable({
    id: p.bigint(),
    claimedById: p.string().references("Account.id").optional(),
    ownerId: p.string().references("Account.id"),
  }),
});
