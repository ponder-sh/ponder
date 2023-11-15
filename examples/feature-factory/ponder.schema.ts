import { p } from "@ponder/core";

export default p.createSchema({
  LlamaCoreInstance: p.createTable({
    id: p.string(),
  }),
});
