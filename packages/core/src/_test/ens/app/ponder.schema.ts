import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  EnsNft: p.createTable({
    id: p.string(),
    labelHash: p.string(),
    ownerId: p.string().references("Account.id"),
    owner: p.one("ownerId"),
    transferredAt: p.int(),
    stringArray: p.string().list(),
    intArray: p.int().list(),
  }),
  Account: p.createTable({
    id: p.string(),
    lastActive: p.int(),
    tokens: p.many("EnsNft.ownerId"),
  }),
}));
