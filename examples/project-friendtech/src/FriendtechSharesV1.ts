import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("FriendtechSharesV1:Trade", async ({ event, context }) => {
  // Skip phantom events
  if (event.args.shareAmount === 0n) {
    return;
  }

  const feeAmount = event.args.protocolEthAmount + event.args.subjectEthAmount;

  const traderAmount = event.args.isBuy
    ? event.args.ethAmount + feeAmount
    : event.args.ethAmount - feeAmount;

  const tradeEvent = await context.db.insert(schema.tradeEvent).values({
    id: event.log.id,
    subject: event.args.subject,
    trader: event.args.trader,
    shareAmount: event.args.shareAmount,
    tradeType: event.args.isBuy ? "BUY" : "SELL",
    ethAmount: event.args.ethAmount,
    protocolEthAmount: event.args.protocolEthAmount,
    subjectEthAmount: event.args.subjectEthAmount,
    supply: event.args.supply,
    timestamp: Number(event.block.timestamp),
    traderAmount: traderAmount,
  });

  await context.db
    .insert(schema.subject)
    .values({
      address: event.args.subject,
      totalTrades: 0n,
      totalShares: 0n,
      lastPrice: 0n,
      earnings: 0n,
      traderVolume: 0n,
      protocolFeesGenerated: 0n,
    })
    .onConflictDoUpdate((row) => {
      const shareDelta =
        tradeEvent.tradeType === "BUY"
          ? tradeEvent.shareAmount
          : -tradeEvent.shareAmount;

      const traderSpend =
        tradeEvent.tradeType === "BUY" ? traderAmount : tradeEvent.ethAmount;

      return {
        totalTrades: row.totalTrades + 1n,
        totalShares: row.totalShares + shareDelta,
        lastPrice:
          tradeEvent.shareAmount > 0
            ? traderSpend / tradeEvent.shareAmount
            : 0n,
        earnings: row.earnings + tradeEvent.subjectEthAmount,
        traderVolume: row.traderVolume + traderSpend,
        protocolFeesGenerated:
          row.protocolFeesGenerated + tradeEvent.protocolEthAmount,
      };
    });

  await context.db
    .insert(schema.trader)
    .values({
      address: event.args.trader,
      totalTrades: 0n,
      spend: 0n,
      earnings: 0n,
      profit: 0n,
      subjectFeesPaid: 0n,
      protocolFeesPaid: 0n,
    })
    .onConflictDoUpdate((row) => {
      const spendDelta = tradeEvent.tradeType === "BUY" ? traderAmount : 0n;
      const earningsDelta = tradeEvent.tradeType === "BUY" ? 0n : traderAmount;
      const profitDelta =
        tradeEvent.tradeType === "BUY" ? -traderAmount : traderAmount;
      return {
        totalTrades: row.totalTrades + 1n,
        spend: row.spend + spendDelta,
        earnings: row.earnings + earningsDelta,
        profit: row.profit + profitDelta,
        subjectFeesPaid: row.subjectFeesPaid + tradeEvent.subjectEthAmount,
        protocolFeesPaid: row.protocolFeesPaid + tradeEvent.protocolEthAmount,
      };
    });

  if (tradeEvent.tradeType === "BUY") {
    await context.db
      .insert(schema.share)
      .values({
        subject: event.args.subject,
        trader: event.args.trader,
        amount: tradeEvent.shareAmount,
      })
      .onConflictDoUpdate((row) => ({
        amount: row.amount + tradeEvent.shareAmount,
      }));
  } else {
    await context.db
      .update(schema.share, {
        subject: event.args.subject,
        trader: event.args.trader,
      })
      .set((row) => ({
        amount: row.amount - tradeEvent.shareAmount,
      }));
  }
});
