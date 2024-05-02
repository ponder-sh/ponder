import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  ChainlinkPrice: p.createTable({
    id: p.bigint(),
    price: p.float(),
  }),
}));
