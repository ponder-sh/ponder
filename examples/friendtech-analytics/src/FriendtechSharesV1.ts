import { ponder } from "@/generated";

ponder.on("FriendtechSharesV1:Trade", async ({ event, context }) => {
  const { Protocol, Share, Subject, TradeEvent, Trader } = context.entities;

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

  let [tradeEvent, subject, trader] = await Promise.all([
    TradeEvent.create({
      id: tradeEventId,
      data: {
        subject: subjectId,
        trader: traderId,
        shareAmount: event.params.shareAmount,
        isBuy: event.params.isBuy,
        ethAmount: event.params.ethAmount,
        protocolEthAmount: event.params.protocolEthAmount,
        subjectEthAmount: event.params.subjectEthAmount,
        supply: event.params.supply,
        timestamp: Number(event.block.timestamp),
        traderAmount: traderAmount,
      },
    }),
    Subject.findUnique({ id: subjectId }),
    Trader.findUnique({ id: traderId }),
  ]);

  if (subject || trader) {
    throw Error("test");
  }

  // Get or create Subject
  if (!subject) {
    subject = await Subject.create({
      id: subjectId,
      data: {
        totalTrades: 0n,
        totalShares: 0n,
        lastPrice: 0n,
        earnings: 0n,
        traderVolume: 0n,
        protocolFeesGenerated: 0n,
      },
    });
  }

  // Get or create Trader
  if (!trader) {
    trader = await Trader.create({
      id: traderId,
      data: {
        totalTrades: 0n,
        spend: 0n,
        earnings: 0n,
        profit: 0n,
        subjectFeesPaid: 0n,
        protocolFeesPaid: 0n,
      },
    });
  }

  const share = await Share.findUnique({ id: shareId });

  // Buy
  if (tradeEvent.isBuy) {
    let sharePromise;

    // Share exists before buy
    if (share) {
      sharePromise = Share.update({
        id: shareId,
        data: {
          shareAmount: share.shareAmount + tradeEvent.shareAmount,
        },
      });

      // Share does not exist before buy
    } else {
      sharePromise = Share.create({
        id: shareId,
        data: {
          subject: subjectId,
          trader: traderId,
          shareAmount: tradeEvent.shareAmount,
        },
      });
    }

    await Promise.all([
      Subject.update({
        id: subjectId,
        data: {
          totalTrades: subject.totalTrades + 1n,
          totalShares: subject.totalShares + tradeEvent.shareAmount,
          lastPrice:
            tradeEvent.shareAmount > 0
              ? tradeEvent.ethAmount / tradeEvent.shareAmount
              : 0n,
          earnings: subject.earnings + tradeEvent.subjectEthAmount,
          traderVolume: subject.traderVolume + traderAmount,
          protocolFeesGenerated:
            subject.protocolFeesGenerated + tradeEvent.protocolEthAmount,
        },
      }),
      Trader.update({
        id: traderId,
        data: {
          totalTrades: subject.totalTrades + 1n,
          spend: trader.spend + traderAmount,
          profit: trader.profit - traderAmount,
          subjectFeesPaid: trader.subjectFeesPaid + tradeEvent.subjectEthAmount,
          protocolFeesPaid:
            trader.protocolFeesPaid + tradeEvent.protocolEthAmount,
        },
      }),
      sharePromise,
    ]);

    // Sell
  } else if (share) {
    const shareAmountAfter = share.shareAmount - tradeEvent.shareAmount;

    let sharePromise;

    // Share exists after sell
    if (shareAmountAfter > 0) {
      sharePromise = Share.update({
        id: shareId,
        data: {
          shareAmount: share.shareAmount - tradeEvent.shareAmount,
        },
      });

      // Share does not exist after sell
    } else {
      sharePromise = Share.delete({
        id: shareId,
      });
    }

    await Promise.all([
      Subject.update({
        id: subjectId,
        data: {
          totalTrades: subject.totalTrades + 1n,
          totalShares: subject.totalShares - tradeEvent.shareAmount,
          lastPrice:
            tradeEvent.shareAmount > 0
              ? tradeEvent.ethAmount / tradeEvent.shareAmount
              : 0n,
          earnings: subject.earnings + tradeEvent.subjectEthAmount,
          traderVolume: subject.traderVolume + tradeEvent.ethAmount,
          protocolFeesGenerated:
            subject.protocolFeesGenerated + tradeEvent.protocolEthAmount,
        },
      }),
      Trader.update({
        id: traderId,
        data: {
          totalTrades: subject.totalTrades + 1n,
          earnings: trader.spend + traderAmount,
          profit: trader.profit + traderAmount,
          subjectFeesPaid: trader.subjectFeesPaid + tradeEvent.subjectEthAmount,
          protocolFeesPaid:
            trader.protocolFeesPaid + tradeEvent.protocolEthAmount,
        },
      }),
      sharePromise,
    ]);
  }
});
