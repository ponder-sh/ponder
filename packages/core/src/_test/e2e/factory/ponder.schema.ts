import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  SwapEvent: p.createTable({
    id: p.string(),
    pair: p.hex(),
    from: p.hex(),
    to: p.hex(),
  }),
}));
