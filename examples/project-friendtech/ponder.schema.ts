import { onchainEnum, onchainTable, primaryKey } from "@ponder/core";

export const tradeType = onchainEnum("trade_type", ["BUY", "SELL"]);

export const share = onchainTable(
  "share",
  (p) => ({
    subject: p.hex().notNull(),
    trader: p.hex().notNull(),
    amount: p.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.subject, table.trader] }),
  }),
);

export const tradeEvent = onchainTable("trade_event", (p) => ({
  id: p.text().primaryKey(),
  subject: p.hex().notNull(),
  trader: p.hex().notNull(),

  shareAmount: p.bigint().notNull(),
  tradeType: tradeType().notNull(),
  ethAmount: p.bigint().notNull(),
  protocolEthAmount: p.bigint().notNull(),
  subjectEthAmount: p.bigint().notNull(),
  traderAmount: p.bigint().notNull(),
  supply: p.bigint().notNull(),
  timestamp: p.integer().notNull(),
}));

export const subject = onchainTable("subject", (p) => ({
  address: p.hex().primaryKey(),
  totalShares: p.bigint().notNull(),
  totalTrades: p.bigint().notNull(),
  lastPrice: p.bigint().notNull(),
  earnings: p.bigint().notNull(),
  traderVolume: p.bigint().notNull(),
  protocolFeesGenerated: p.bigint().notNull(),
}));

export const trader = onchainTable("trader", (p) => ({
  address: p.hex().primaryKey(),
  totalTrades: p.bigint().notNull(),
  spend: p.bigint().notNull(),
  earnings: p.bigint().notNull(),
  profit: p.bigint().notNull(),
  subjectFeesPaid: p.bigint().notNull(),
  protocolFeesPaid: p.bigint().notNull(),
}));
