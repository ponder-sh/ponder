import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  transferEvent,
} from "ponder:schema";

ponder.on("RocketTokenRETH:Transfer", async ({ event, context }) => {
  await context.db
    .insert(account)
    .values({ address: event.args.from, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance - event.args.value,
    }));

  await context.db
    .insert(account)
    .values({ address: event.args.to, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + event.args.value,
    }));

  await context.db.insert(transferEvent).values({
    id: event.id,
    amount: event.args.value,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });
});

ponder.on("RocketTokenRETH:Approval", async ({ event, context }) => {
  await context.db
    .insert(allowance)
    .values({
      spender: event.args.spender,
      owner: event.args.owner,
      amount: event.args.value,
    })
    .onConflictDoUpdate({ amount: event.args.value });

  await context.db.insert(approvalEvent).values({
    id: event.id,
    amount: event.args.value,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });

  await context.db.sql.select().from(account).limit(1);
});
