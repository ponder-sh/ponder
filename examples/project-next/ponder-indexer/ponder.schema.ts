import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.string(),
    balance: p.bigint(),

    transferFromEvents: p.many("TransferEvent.fromId"),
    transferToEvents: p.many("TransferEvent.toId"),
  }),
  TransferEvent: p.createTable({
    id: p.string(),
    amount: p.bigint(),
    timestamp: p.int(),

    fromId: p.string().references("Account.id"),
    toId: p.string().references("Account.id"),

    from: p.one("fromId"),
    to: p.one("toId"),
  }),
}));
