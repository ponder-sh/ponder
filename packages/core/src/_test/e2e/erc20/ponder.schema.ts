import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  Account: p.createTable({
    id: p.hex(),
    balance: p.bigint(),
  }),
}));
