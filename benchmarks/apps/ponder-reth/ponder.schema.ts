import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.string(),
    balance: p.bigint(),
    isOwner: p.boolean(),

    approvals: p.many("Approval.ownerId"),
    approvalOwnerEvents: p.many("ApprovalEvent.ownerId"),
    approvalSpenderEvents: p.many("ApprovalEvent.spenderId"),
    transferFromEvents: p.many("TransferEvent.fromId"),
    transferToEvents: p.many("TransferEvent.toId"),
  }),
  Approval: p.createTable({
    id: p.bytes(),
    amount: p.bigint(),

    ownerId: p.string().references("Account.id"),
    spenderId: p.string().references("Account.id"),

    owner: p.one("ownerId"),
    spender: p.one("spenderId"),
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
  ApprovalEvent: p.createTable({
    id: p.string(),
    amount: p.bigint(),
    timestamp: p.int(),

    ownerId: p.string().references("Account.id"),
    spenderId: p.string().references("Account.id"),

    owner: p.one("ownerId"),
    spender: p.one("spenderId"),
  }),
}));
