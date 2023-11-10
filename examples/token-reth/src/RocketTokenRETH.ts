import { ponder } from "@/generated";

ponder.on("RocketTokenRETH:Transfer", async ({ event, context }) => {
  await context.models.Transfer.create({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    data: {
      sender: event.params.from,
      receiver: event.params.to,
      amount: event.params.value,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      logIndex: event.log.logIndex,
    },
  });
});

ponder.on("RocketTokenRETH:Approval", async ({ event, context }) => {
  await context.models.Approval.create({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    data: {
      owner: event.params.owner,
      spender: event.params.spender,
      value: event.params.value,
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      logIndex: event.log.logIndex,
    },
  });
});
