import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  SwapEvent: p.createTable({
    id: p.string(),
    from: p.bytes(),
    to: p.bytes(),
  }),
}));
