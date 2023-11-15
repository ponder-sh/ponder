import { p } from "@ponder/core";

export default p.createSchema({
  PoolTokens: p.createTable({
    id: p.string(),
    token0: p.string(),
    token1: p.string(),
  }),
  TokenPaid: p.createTable({
    id: p.string(),
    amount: p.bigint(),
  }),
  TokenBorrowed: p.createTable({
    id: p.string(),
    amount: p.bigint(),
  }),
});
