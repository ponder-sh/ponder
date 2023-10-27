import { createSchema, createTable, p } from "@ponder/core";

export const schema = createSchema({
  EnsNft: createTable({
    id: p.string(),
    labelHash: p.string(),
    ownerId: p.string({ references: "Account.id" }),
    transferredAt: p.int(),
    stringArray: p.stirng({ list: true }),
    intArray: p.int({ list: true }),
  }),
  Account: createTable({
    id: p.string(),
    lastActive: p.int(),
    tokens: p.virtual("EnsNft.ownerId"),
  }),
});
