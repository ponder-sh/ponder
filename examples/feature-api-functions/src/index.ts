import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  await context.db
    .upsert(schema.account, { address: event.args.from })
    .insert({ balance: 0n, isOwner: false })
    .update((row) => ({
      balance: row.balance - event.args.amount,
    }));

  await context.db
    .upsert(schema.account, { address: event.args.to })
    .insert({ balance: 0n, isOwner: false })
    .update((row) => ({
      balance: row.balance + event.args.amount,
    }));

  // add row to "transfer_event".
  await context.db.insert(schema.transferEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });
});

ponder.on("ERC20:Approval", async ({ event, context }) => {
  // upsert "allowance".
  await context.db
    .upsert(schema.allowance, {
      spender: event.args.spender,
      owner: event.args.owner,
    })
    .insert({ amount: event.args.amount })
    .update({ amount: event.args.amount });

  // add row to "approval_event".
  await context.db.insert(schema.approvalEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
