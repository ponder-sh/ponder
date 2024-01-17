import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  Example: p.createTable({
    id: p.string(),
    name: p.string().optional(),
  }),
}));
