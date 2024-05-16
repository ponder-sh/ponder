import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  multicalls: p.createTable({
    id: p.hex(),
    gasUsed: p.bigint(),
    bytes: p.int(),
    successfulCalls: p.int(),
    failedCalls: p.int(),
  }),
}));
