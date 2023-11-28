import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
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
}));
