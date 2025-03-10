import { onchainTable } from "ponder";

export const factory = onchainTable("uniswap_factory", (t) => ({
  id: t.text().primaryKey(),
  pairCount: t.integer().notNull(),
  txCount: t.integer().notNull(),
}));

export const pair = onchainTable("uniswap_pair", (t) => ({
  id: t.text().primaryKey(),
  token0: t.hex().notNull(),
  token1: t.hex().notNull(),
  reserve0: t.bigint().notNull(),
  reserve1: t.bigint().notNull(),
  totalSupply: t.bigint().notNull(),
  txCount: t.integer().notNull(),
  createdAtTimestamp: t.bigint().notNull(),
  createdAtBlockNumber: t.bigint().notNull(),
}));

export const mint = onchainTable("uniswap_mint", (t) => ({
  id: t.text().primaryKey(),
  timestamp: t.bigint().notNull(),
  pair: t.hex().notNull(),
  sender: t.hex().notNull(),
  amount0: t.bigint().notNull(),
  amount1: t.bigint().notNull(),
  logIndex: t.integer().notNull(),
}));

export const burn = onchainTable("uniswap_burn", (t) => ({
  id: t.text().primaryKey(),
  timestamp: t.bigint().notNull(),
  pair: t.hex().notNull(),
  sender: t.hex().notNull(),
  amount0: t.bigint().notNull(),
  amount1: t.bigint().notNull(),
  to: t.hex().notNull(),
  logIndex: t.integer().notNull(),
}));

export const swap = onchainTable("uniswap_swap", (t) => ({
  id: t.text().primaryKey(),
  timestamp: t.bigint().notNull(),
  pair: t.hex().notNull(),
  sender: t.hex().notNull(),
  from: t.hex().notNull(),
  amount0In: t.bigint().notNull(),
  amount1In: t.bigint().notNull(),
  amount0Out: t.bigint().notNull(),
  amount1Out: t.bigint().notNull(),
  to: t.hex().notNull(),
  logIndex: t.integer().notNull(),
}));
