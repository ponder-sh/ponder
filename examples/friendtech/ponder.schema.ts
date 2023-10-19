// import { column, createSchema, table, enum } from "@ponder/core";

// export const schema = createSchema({
//   TradeType: enum(["BUY", "SELL"]),
//   Share: table({
//     id: column("bytes"),
//     subjectId: column("bytes", { references: "Subject.id" }),
//     traderId: column("bytes", { references: "Trader.id" }),
//     shareAmount: column("bigint"),
//   }),
//   TradeEvent: table({
//     id: column("bytes"),
//     subjectId: column("bytes", { references: "Subject.id" }),
//     traderId: column("bytes", { references: "Trader.id" }),
//     shareAmount: column("bigint"),
//     tradeType: column("TradeType"),
//     ethAmount: column("bigint"),
//     protocolEthAmount: column("bigint"),
//     subjectEthAmount: column("bigint"),
//     traderAmount: column("bigint"),
//     supply: column("bigint"),
//     timestamp: column("int"),
//   }),
//   Subject: table({
//     id: column("bytes"),
//     totalTrades: column("bigint"),
//     spend: column("bigint"),
//     earnings: column("bigint"),
//     profit: column("bigint"),
//     subjectFeesPaid: column("bigint"),
//     protocolFeesPaid: column("bigint"),
//   }),
//   Trader: table({
//     id: column("bytes"),
//     totalTrades: column("bigint"),
//     spend: column("bigint"),
//     earnings: column("bigint"),
//     profit: column("bigint"),
//     subjectFeesPaid: column("bigint"),
//     protocolFeesPaid: column("bigint"),
//   }),
//   Protocol: table({
//     id: column("int"),
//     earnings: column("bigint"),
//   }),
// });
