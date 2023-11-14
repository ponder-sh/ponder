import { p } from "@ponder/core";

export default p.createSchema({
  SwapEvent: p.createTable({
    id: p.string(),
    recipient: p.string(),
    payer: p.string(),
  }),
});
