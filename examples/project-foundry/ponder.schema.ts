import { p } from "@ponder/core";

export default p.createSchema({
  Counter: p.createTable({
    id: p.int(),
    value: p.int(),
    block: p.int(),
  }),
});
