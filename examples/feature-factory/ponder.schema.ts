import { onchainTable } from "@ponder/core";

export const llama = onchainTable("llama", (t) => ({
  id: t.text().primaryKey(),
}));
