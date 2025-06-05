import { onchainTable, primaryKey } from "ponder";

export const global = onchainTable("global", (p) => ({
  // TODO(kyle) default
  id: p.integer().primaryKey(),
  startedAt: p.integer("started_at").notNull(),
  epochDuration: p.integer("epoch_duration").notNull(),
}));

export const account = onchainTable("account", (p) => ({
  address: p.hex().primaryKey(),
  totalPixels: p.integer("total_pixels").notNull(),
}));

export const brush = onchainTable("brush", (p) => ({
  id: p.integer().primaryKey(),
  ownerId: p.hex("owner_id").notNull(),
  strength: p.integer().notNull(),
  strengthRemaining: p.integer("strength_remaining").notNull(),
  lastUsedTimestamp: p.integer("last_used_timestamp"),
  lastUsedDay: p.integer("last_used_day"),
  streak: p.integer().notNull(),
}));

export const contribution = onchainTable(
  "contribution",
  (p) => ({
    day: p.integer("day").notNull(),
    accountId: p.hex("account_id").notNull(),
    canvasId: p.integer("canvas_id").notNull(),
    pixelsCount: p.integer("pixels_count").notNull(),
  }),
  (table) => ({
    primaryKey: primaryKey({ columns: [table.accountId, table.day] }),
  }),
);

export const usage = onchainTable(
  "usage",
  (p) => ({
    day: p.integer("day").notNull(),
    tokenId: p.integer("token_id").notNull(),
    brushId: p.integer("brush_id").notNull(),
    canvasId: p.integer("canvas_id").notNull(),
    pixelsCount: p.integer("pixels_count").notNull(),
  }),
  (table) => ({
    primaryKey: primaryKey({ columns: [table.tokenId, table.day] }),
  }),
);

export const stroke = onchainTable("stroke", (p) => ({
  id: p.text().primaryKey(),
  canvasId: p.integer("canvas_id").notNull(),
  accountId: p.hex("account_id").notNull(),
  brushId: p.integer("brush_id").notNull(),
  data: p.text().notNull(),
  tx: p.hex().notNull(),
  timestamp: p.integer().notNull(),
}));

export const withdrawal = onchainTable(
  "withdrawal",
  (p) => ({
    day: p.integer().notNull(),
    accountId: p.hex("account_id").notNull(),
    canvasId: p.integer("canvas_id"),
    amount: p.bigint().notNull(),
    timestamp: p.integer().notNull(),
  }),
  (table) => ({
    primaryKey: primaryKey({ columns: [table.accountId, table.day] }),
  }),
);

export const canvas = onchainTable("canvas", (p) => ({
  day: p.integer().primaryKey(),
  totalMints: p.integer("total_mints").notNull(),
  totalEarned: p.bigint("total_earned").notNull(),
  totalArtists: p.integer("total_artists").notNull(),
  pixelsCount: p.integer("pixels_count").notNull(),
}));
