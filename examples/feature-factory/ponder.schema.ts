import { onchainTable } from "ponder";

export const llama = onchainTable("llama", (t) => ({
  id: t.text().primaryKey(),
}));
