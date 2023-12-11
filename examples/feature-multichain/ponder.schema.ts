import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.bytes(),
    balance: p.bigint(),
  }),
}));
