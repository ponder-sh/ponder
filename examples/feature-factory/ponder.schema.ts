import { onchainTable } from "@ponder/core";

export const llama = onchainTable("llama", (p) => ({
  id: p.text().primaryKey(),
}));
