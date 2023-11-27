import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.string(),
    tokens: p.many("Token.ownerId"),

    transferFromEvents: p.many("TransferEvent.fromId"),
    transferToEvents: p.many("TransferEvent.toId"),
  }),
  Token: p.createTable({
    id: p.bigint(),
    ownerId: p.string().references("Account.id"),

    owner: p.one("ownerId"),
    transferEvents: p.many("TransferEvent.tokenId"),
  }),
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
    fromId: p.string().references("Account.id"),
    toId: p.string().references("Account.id"),
    tokenId: p.bigint().references("Token.id"),

    from: p.one("fromId"),
    to: p.one("toId"),
    token: p.one("tokenId"),
  }),
}));
