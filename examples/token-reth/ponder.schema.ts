import { p } from "@ponder/core";

export default p.createSchema({
  Transfer: p.createTable({
    id: p.string(),
    sender: p.string(),
    receiver: p.string(),
    amount: p.bigint(),
    timestamp: p.bigint(),
    txHash: p.string(),
    blockNumber: p.bigint(),
    logIndex: p.int(),
  }),
  Approval: p.createTable({
    id: p.string(),
    owner: p.string(),
    spender: p.string(),
    value: p.bigint(),
    timestamp: p.bigint(),
    txHash: p.string(),
    blockNumber: p.bigint(),
    logIndex: p.int(),
  }),
});
