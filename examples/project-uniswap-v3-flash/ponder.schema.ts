import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  TokenPaid: p.createTable({
    id: p.bytes(),
    amount: p.bigint(),
  }),
  TokenBorrowed: p.createTable({
    id: p.bytes(),
    amount: p.bigint(),
  }),
}));
