import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.bytes(),
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

    ownerId: p.bytes().references("Account.id"),
    spenderId: p.bytes().references("Account.id"),

    owner: p.one("ownerId"),
    spender: p.one("spenderId"),
  }),
  TransferEvent: p.createTable({
    id: p.string(),
    amount: p.bigint(),
    timestamp: p.int(),

    fromId: p.bytes().references("Account.id"),
    toId: p.bytes().references("Account.id"),

    from: p.one("fromId"),
    to: p.one("toId"),
  }),
  ApprovalEvent: p.createTable({
    id: p.string(),
    amount: p.bigint(),
    timestamp: p.int(),

    ownerId: p.bytes().references("Account.id"),
    spenderId: p.bytes().references("Account.id"),

    owner: p.one("ownerId"),
    spender: p.one("spenderId"),
  }),
}));
