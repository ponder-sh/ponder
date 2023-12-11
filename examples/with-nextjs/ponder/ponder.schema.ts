import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  DepositEvent: p.createTable({
    id: p.string(),
    timestamp: p.int(),
    amount: p.bigint(),
    account: p.string(),
  }),
}));
