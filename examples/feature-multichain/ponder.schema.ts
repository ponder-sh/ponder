import { p } from "@ponder/core";

export default p.createSchema({
  Account: p.createTable({
    id: p.string(),
    balance: p.bigint(),
  }),
});
