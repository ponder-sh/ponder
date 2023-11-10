import { ponder } from "@/generated";

ponder.on("FriendtechSharesV1:Trade", async ({ event, context }) => {
  const { Share, Subject, TradeEvent, Trader } = context.models;

  // Skip phantom events
  if (event.params.shareAmount === 0n) {
    return;
  }

  const subjectId = event.params.subject;
  const traderId = event.params.trader;
  const shareId = event.params.subject + "-" + event.params.trader;
  const tradeEventId =
    event.transaction.hash + "-" + event.log.logIndex.toString();

  const feeAmount =
    event.params.protocolEthAmount + event.params.subjectEthAmount;

  const traderAmount = event.params.isBuy
    ? event.params.ethAmount + feeAmount
    : event.params.ethAmount - feeAmount;

  const tradeEvent = await TradeEvent.create({
    id: tradeEventId as `0x${string}`,
    data: {
      subjectId: subjectId,
      traderId: traderId,
      shareAmount: event.params.shareAmount,
      tradeType: event.params.isBuy ? "BUY" : "SELL",
      ethAmount: event.params.ethAmount,
      protocolEthAmount: event.params.protocolEthAmount,
      subjectEthAmount: event.params.subjectEthAmount,
      supply: event.params.supply,
      timestamp: Number(event.block.timestamp),
      traderAmount: traderAmount,
    },
  });

  await Subject.upsert({
    id: subjectId,
    create: {
      totalTrades: 0n,
      totalShares: 0n,
      lastPrice: 0n,
      earnings: 0n,
      traderVolume: 0n,
      protocolFeesGenerated: 0n,
    },
    update: ({ current }) => {
      const shareDelta =
        tradeEvent.tradeType === "BUY"
          ? tradeEvent.shareAmount
          : -tradeEvent.shareAmount;

      const traderSpend =
        tradeEvent.tradeType === "BUY" ? traderAmount : tradeEvent.ethAmount;

      return {
        totalTrades: current.totalTrades + 1n,
        totalShares: current.totalShares + shareDelta,
        lastPrice:
          tradeEvent.shareAmount > 0
            ? traderSpend / tradeEvent.shareAmount
            : 0n,
        earnings: current.earnings + tradeEvent.subjectEthAmount,
        traderVolume: current.traderVolume + traderSpend,
        protocolFeesGenerated:
          current.protocolFeesGenerated + tradeEvent.protocolEthAmount,
      };
    },
  });

  await Trader.upsert({
    id: traderId,
    create: {
      totalTrades: 0n,
      spend: 0n,
      earnings: 0n,
      profit: 0n,
      subjectFeesPaid: 0n,
      protocolFeesPaid: 0n,
    },
    update: ({ current }) => {
      const spendDelta = tradeEvent.tradeType === "BUY" ? traderAmount : 0n;
      const earningsDelta = tradeEvent.tradeType === "BUY" ? 0n : traderAmount;
      const profitDelta =
        tradeEvent.tradeType === "BUY" ? -traderAmount : traderAmount;
      return {
        totalTrades: current.totalTrades + 1n,
        spend: current.spend + spendDelta,
        earnings: current.earnings + earningsDelta,
        profit: current.profit + profitDelta,
        subjectFeesPaid: current.subjectFeesPaid + tradeEvent.subjectEthAmount,
        protocolFeesPaid:
          current.protocolFeesPaid + tradeEvent.protocolEthAmount,
      };
    },
  });

  if (tradeEvent.tradeType === "BUY") {
    await Share.upsert({
      id: shareId as `0x${string}`,
      create: {
        subjectId,
        traderId,
        shareAmount: tradeEvent.shareAmount,
      },
      update: ({ current }) => ({
        shareAmount: current.shareAmount + tradeEvent.shareAmount,
      }),
    });
  } else {
    const share = await Share.update({
      id: shareId as `0x${string}`,
      data: ({ current }) => ({
        shareAmount: current.shareAmount - tradeEvent.shareAmount,
      }),
    });

    if (share.shareAmount === 0n) {
      await Share.delete({
        id: shareId as `0x${string}`,
      });
    }
  }
});
