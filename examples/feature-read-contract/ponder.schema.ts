import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  File: p.createTable({
    id: p.string(),
    name: p.string(),
    size: p.int(),
    contents: p.string(),
    createdAt: p.int(),
    type: p.string().optional(),
    encoding: p.string().optional(),
    compression: p.string().optional(),
  }),
}));
