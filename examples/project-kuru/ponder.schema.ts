import { index, onchainTable, relations } from "ponder";

export const trade = onchainTable(
  "trade",
  (t) => ({
    id: t.text().primaryKey(),
    orderId: t.integer().notNull(),
    maker: t.hex().notNull(),
    taker: t.hex().notNull(),
    txOrigin: t.hex().notNull(),
    isBuy: t.boolean().notNull(),
    price: t.bigint().notNull(),
    filledSize: t.bigint().notNull(),
    updatedSize: t.bigint().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    makerIdx: index("trade_maker_idx").on(table.maker),
    takerIdx: index("trade_taker_idx").on(table.taker),
  }),
);

export const order = onchainTable(
  "order",
  (t) => ({
    orderId: t.integer().primaryKey(),
    owner: t.hex().notNull(),
    size: t.bigint().notNull(),
    price: t.integer().notNull(),
    isBuy: t.boolean().notNull(),
    isCanceled: t.boolean().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    ownerIdx: index("order_owner_idx").on(table.owner),
  }),
);

export const orderRelations = relations(order, ({ many }) => ({
  trades: many(trade, { relationName: "order_trades" }),
}));

export const tradeRelations = relations(trade, ({ one }) => ({
  order: one(order, {
    relationName: "order_trades",
    fields: [trade.orderId],
    references: [order.orderId],
  }),
}));

export const cancelEvent = onchainTable(
  "cancel_event",
  (t) => ({
    id: t.text().primaryKey(),
    orderIds: t.text().notNull(),
    owner: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    ownerIdx: index("cancel_owner_idx").on(table.owner),
  }),
);
