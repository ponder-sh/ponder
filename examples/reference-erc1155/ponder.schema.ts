import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.hex(),
    tokens: p.many("TokenBalance.ownerId"),

    transferFromEvents: p.many("TransferEvent.fromId"),
    transferToEvents: p.many("TransferEvent.toId"),
  }),
  TokenBalance: p.createTable({
    id: p.string(),
    tokenId: p.bigint(),
    balance: p.bigint(),

    ownerId: p.hex().references("Account.id"),
    owner: p.one("ownerId"),
  }),
  TransferEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
    fromId: p.hex().references("Account.id"),
    toId: p.hex().references("Account.id"),
    tokenId: p.bigint(),

    from: p.one("fromId"),
    to: p.one("toId"),
  }),
}));
