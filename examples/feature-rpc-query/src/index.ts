import { ponder } from "ponder:registry";
import { minterTransaction, usdcTransfer } from "ponder:schema";

ponder.on("USDC:Transfer", async ({ event, context }) => {
  await context.db.insert(usdcTransfer).values({
    id: event.id,
    from: event.args.from,
    to: event.args.to,
    amount: event.args.amount,
    timestamp: event.block.timestamp,
  });
});

ponder.on("USDCMinter:transaction:from", async ({ event, context }) => {
  await context.db.insert(minterTransaction).values({
    id: event.id,
    to: event.transaction.to,
    value: event.transaction.value,
    data: event.transaction.input,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});
