import { p } from "@ponder/core";

export default p.createSchema({
  Account: p.createTable({
    id: p.string(),
    tokens: p.virtual("Token.ownerId"),
    transferFromEvents: p.virtual("TransferEvent.fromId"),
    transferToEvents: p.virtual("TransferEvent.toId"),
  }),
  Token: p.createTable({
    id: p.bigint(),
    ownerId: p.string().references("Account.id"),
    transferEvents: p.virtual("TransferEvent.tokenId"),
  }),
  TransferEvent: p.createTable({
    id: p.string(),
    fromId: p.string().references("Account.id"),
    toId: p.string().references("Account.id"),
    tokenId: p.bigint().references("Token.id"),
    timestamp: p.int(),
  }),
});
