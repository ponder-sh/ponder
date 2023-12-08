import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  SwapEvent: p.createTable({
    id: p.bytes(),
    recipient: p.bytes(),
    payer: p.bytes(),
  }),
}));
