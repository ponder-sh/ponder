import { onchainTable } from "@ponder/core";

export const tokenPaid = onchainTable("token_paid", (p) => ({
  address: p.hex().primaryKey(),
  amount: p.bigint().notNull(),
}));

export const tokenBorrowed = onchainTable("token_borrowed", (p) => ({
  address: p.hex().primaryKey(),
  amount: p.bigint().notNull(),
}));
