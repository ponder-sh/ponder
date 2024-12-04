import { onchainTable } from "ponder";

export const tokenPaid = onchainTable("token_paid", (t) => ({
  address: t.hex().primaryKey(),
  amount: t.bigint().notNull(),
}));

export const tokenBorrowed = onchainTable("token_borrowed", (t) => ({
  address: t.hex().primaryKey(),
  amount: t.bigint().notNull(),
}));
