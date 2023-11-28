import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.string(),
    balance: p.bigint(),
  }),
}));
