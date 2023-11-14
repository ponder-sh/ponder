import { p } from "@ponder/core";

export default p.createSchema({
  GobbledArt: p.createTable({
    id: p.string(),
    user: p.string(),
  }),
});
