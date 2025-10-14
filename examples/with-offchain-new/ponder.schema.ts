import { index, onchainTable, relations } from "ponder";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint().notNull(),
  isOwner: t.boolean().notNull(),
}));

export const accountRelations = relations(account, ({ many }) => ({
  transferFromEvents: many(transferEvent, { relationName: "from_account" }),
  transferToEvents: many(transferEvent, { relationName: "to_account" }),
}));

export const transferEvent = onchainTable(
  "transfer_event",
  (t) => ({
    id: t.text().primaryKey(),
    amount: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
  }),
  (table) => ({
    fromIdx: index("from_index").on(table.from),
  }),
);

export const transferEventRelations = relations(transferEvent, ({ one }) => ({
  fromAccount: one(account, {
    relationName: "from_account",
    fields: [transferEvent.from],
    references: [account.address],
  }),
  toAccount: one(account, {
    relationName: "to_account",
    fields: [transferEvent.to],
    references: [account.address],
  }),
}));
