import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  SwapEvent: p.createTable({
    id: p.string(),
    pair: p.bytes(),
    from: p.bytes(),
    to: p.bytes(),
  }),
}));
