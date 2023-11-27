import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  LlamaCoreInstance: p.createTable({
    id: p.string(),
  }),
}));
