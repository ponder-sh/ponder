import { p } from "@ponder/core";

export const schema = p.createSchema({
  LlamaCoreInstance: p.createTable({
    id: p.string(),
  }),
});
