import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  SetupEntity: p.createTable({
    id: p.string(),
  }),
  Account: p.createTable({
    id: p.string(),
    tokens: p.many("Token.ownerId"),
  }),

  Token: p.createTable({
    id: p.bigint(),
    claimedById: p.string().references("Account.id").optional(),
    ownerId: p.string().references("Account.id"),

    claimedBy: p.one("claimedById"),
    owner: p.one("ownerId"),
  }),
}));
