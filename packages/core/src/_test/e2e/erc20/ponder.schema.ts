import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.bytes(),
    balance: p.bigint(),
  }),
}));
