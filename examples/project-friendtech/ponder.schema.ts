import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  TradeType: p.createEnum(["BUY", "SELL"]),
  Share: p.createTable({
    id: p.string(),

    subjectId: p.hex().references("Subject.id"),
    traderId: p.hex().references("Trader.id"),

    subject: p.one("subjectId"),
    trader: p.one("traderId"),

    shareAmount: p.bigint(),
  }),
  TradeEvent: p.createTable({
    id: p.string(),

    subjectId: p.hex().references("Subject.id"),
    traderId: p.hex().references("Trader.id"),

    subject: p.one("subjectId"),
    trader: p.one("traderId"),

    shareAmount: p.bigint(),
    tradeType: p.enum("TradeType"),
    ethAmount: p.bigint(),
    protocolEthAmount: p.bigint(),
    subjectEthAmount: p.bigint(),
    traderAmount: p.bigint(),
    supply: p.bigint(),
    timestamp: p.int(),
  }),
  Subject: p.createTable({
    id: p.hex(),
    totalShares: p.bigint(),
    totalTrades: p.bigint(),
    lastPrice: p.bigint(),
    earnings: p.bigint(),
    traderVolume: p.bigint(),
    protocolFeesGenerated: p.bigint(),

    shares: p.many("Share.subjectId"),
    trades: p.many("TradeEvent.subjectId"),
  }),
  Trader: p.createTable({
    id: p.hex(),
    totalTrades: p.bigint(),
    spend: p.bigint(),
    earnings: p.bigint(),
    profit: p.bigint(),
    subjectFeesPaid: p.bigint(),
    protocolFeesPaid: p.bigint(),

    shares: p.many("Share.traderId"),
    trades: p.many("TradeEvent.traderId"),
  }),
  Protocol: p.createTable({
    id: p.int(),
    earnings: p.bigint(),
  }),
}));
