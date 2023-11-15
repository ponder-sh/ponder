import { p } from "../../../../dist";

export default p.createSchema({
  EnsNft: p.createTable({
    id: p.string(),
    labelHash: p.string(),
    ownerId: p.string().references("Account.id"),
    transferredAt: p.int(),
    stringArray: p.string().list(),
    intArray: p.int().list(),
  }),
  Account: p.createTable({
    id: p.string(),
    lastActive: p.int(),
    tokens: p.virtual("EnsNft.ownerId"),
  }),
});
