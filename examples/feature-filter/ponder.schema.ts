import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  SwapEvent: p.createTable({
    id: p.string(),
    recipient: p.string(),
    payer: p.string(),
  }),
}));
