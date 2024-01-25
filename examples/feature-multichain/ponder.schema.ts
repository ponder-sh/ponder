import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.hex(),
    balance: p.bigint(),
  }),
}));
