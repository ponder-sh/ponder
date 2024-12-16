import { onchainTable } from "ponder";

export const llama = onchainTable("llama", (t) => ({
  id: t.text().primaryKey(),
}));

export const childContract = onchainTable("childContract", (t) => ({
  id: t.text().primaryKey(),
}));
