import { column, createSchema, table } from "@ponder/core";

export const schema = createSchema({
  EnsNft: table({
    id: column("string"),
    labelHash: column("string"),
    ownerId: column("string", { references: "Account.id" }),
    transferredAt: column("int"),
    stringArray: column("string", { list: true }),
    intArray: column("int", { list: true }),
  }),
  Account: table({
    id: column("string"),
    lastActive: column("int"),
  }),
});
