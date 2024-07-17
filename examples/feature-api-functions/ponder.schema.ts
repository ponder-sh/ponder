import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  SwapEvent: p.createTable({
    id: p.string(),
    recipient: p.hex(),
    payer: p.hex(),
  }),
}));
