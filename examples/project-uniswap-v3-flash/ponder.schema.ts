import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  PoolTokens: p.createTable({
    id: p.bytes(),
    token0: p.bytes(),
    token1: p.bytes(),
  }),
  TokenPaid: p.createTable({
    id: p.bytes(),
    amount: p.bigint(),
  }),
  TokenBorrowed: p.createTable({
    id: p.bytes(),
    amount: p.bigint(),
  }),
}));
