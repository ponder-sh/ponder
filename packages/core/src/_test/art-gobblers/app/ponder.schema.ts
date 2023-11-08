import { p } from "../../../../dist";

export const schema = p.createSchema({
  SetupEntity: p.createTable({
    id: p.string(),
  }),
  Account: p.createTable({
    id: p.string(),
    tokens: p.virtual("Token.ownerId"),
  }),

  Token: p.createTable({
    id: p.bigint(),
    claimedById: p.string().references("Account.id").optional(),
    ownerId: p.string().references("Account.id"),
  }),
});
