import { p } from "@ponder/core";

export const schema = p.createSchema({
  GobbledArt: p.createTable({
    id: p.string(),
    user: p.string(),
  }),
});
