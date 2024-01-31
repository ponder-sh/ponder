import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  TokenPaid: p.createTable({
    id: p.hex(),
    amount: p.bigint(),
  }),
  TokenBorrowed: p.createTable({
    id: p.hex(),
    amount: p.bigint(),
  }),
}));
