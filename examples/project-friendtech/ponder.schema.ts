import { onchainEnum, onchainTable, primaryKey } from "ponder";

export const tradeType = onchainEnum("trade_type", ["BUY", "SELL"]);

export const share = onchainTable(
  "share",
  (t) => ({
    subject: t.hex().notNull(),
    trader: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.subject, table.trader] }),
  }),
);

export const tradeEvent = onchainTable("trade_event", (t) => ({
  id: t.text().primaryKey(),
  subject: t.hex().notNull(),
  trader: t.hex().notNull(),

  shareAmount: t.bigint().notNull(),
  tradeType: tradeType().notNull(),
  ethAmount: t.bigint().notNull(),
  protocolEthAmount: t.bigint().notNull(),
  subjectEthAmount: t.bigint().notNull(),
  traderAmount: t.bigint().notNull(),
  supply: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
}));

export const subject = onchainTable("subject", (t) => ({
  address: t.hex().primaryKey(),
  totalShares: t.bigint().notNull(),
  totalTrades: t.bigint().notNull(),
  lastPrice: t.bigint().notNull(),
  earnings: t.bigint().notNull(),
  traderVolume: t.bigint().notNull(),
  protocolFeesGenerated: t.bigint().notNull(),
}));

export const trader = onchainTable("trader", (t) => ({
  address: t.hex().primaryKey(),
  totalTrades: t.bigint().notNull(),
  spend: t.bigint().notNull(),
  earnings: t.bigint().notNull(),
  profit: t.bigint().notNull(),
  subjectFeesPaid: t.bigint().notNull(),
  protocolFeesPaid: t.bigint().notNull(),
}));
