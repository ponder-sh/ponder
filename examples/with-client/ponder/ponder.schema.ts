import { onchainTable, onchainView } from "ponder";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint().notNull(),
}));

export const accountView = onchainView("accountView").as((qb) =>
  qb.select().from(account),
);
