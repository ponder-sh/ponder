import * as p from "../../../schema/index.js";

export default p.createSchema({
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
  }),
});
