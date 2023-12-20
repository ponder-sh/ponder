import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.string(),
    assetsBalance: p.bigint(),
    sharesBalance: p.bigint(),

    depositSenderEvents: p.many("DepositEvent.sender"),
    depositReceiverEvents: p.many("DepositEvent.receiver"),

    withdrawSenderEvents: p.many("WithdrawEvent.sender"),
    withdrawReceiverEvents: p.many("WithdrawEvent.receiver"),
    withdrawOwnerEvents: p.many("WithdrawEvent.owner"),
  }),
  DepositEvent: p.createTable({
    id: p.string(),
    sender: p.string().references("Account.id"),
    receiver: p.string().references("Account.id"),
    assets: p.bigint(),
    shares: p.bigint(),
  }),
  WithdrawEvent: p.createTable({
    id: p.string(),
    sender: p.string().references("Account.id"),
    receiver: p.string().references("Account.id"),
    owner: p.string().references("Account.id"),
    assets: p.bigint(),
    shares: p.bigint(),
  }),
}));
