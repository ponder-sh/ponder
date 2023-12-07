import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Counter: p.createTable({
    id: p.int(),
    value: p.int(),
    block: p.int(),
  }),
}));
