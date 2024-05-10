import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  multicalls: p.createTable({
    id: p.bigint(),
  }),
}));
