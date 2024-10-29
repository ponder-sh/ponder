import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC4626:Transfer", async ({ event, context }) => {
  // Create an Account for the sender, or update the balance if it already exists.
  await context.db
    .upsert(schema.account, { address: event.args.from })
    .insert({ balance: 0n })
    .update((row) => ({ balance: row.balance - event.args.amount }));

  // Create an Account for the recipient, or update the balance if it already exists.
  await context.db
    .upsert(schema.account, { address: event.args.to })
    .insert({ balance: event.args.amount })
    .update((row) => ({ balance: row.balance + event.args.amount }));

  // Create a TransferEvent.
  await context.db.insert(schema.transferEvent).values({
    from: event.args.from,
    to: event.args.to,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("ERC4626:Approval", async ({ event, context }) => {
  // Create or update the Allowance.
  await context.db
    .upsert(schema.allowance, {
      owner: event.args.owner,
      spender: event.args.spender,
    })
    .insert({
      amount: event.args.amount,
    })
    .update({ amount: event.args.amount });

  // Create an ApprovalEvent.
  await context.db.insert(schema.approvalEvent).values({
    owner: event.args.owner,
    spender: event.args.spender,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("ERC4626:Deposit", async ({ event, context }) => {
  await context.db.insert(schema.depositEvent).values({
    sender: event.args.caller,
    receiver: event.args.owner,
    assets: event.args.assets,
    shares: event.args.shares,
  });
});

ponder.on("ERC4626:Withdraw", async ({ event, context }) => {
  await context.db.insert(schema.withdrawalEvent).values({
    sender: event.args.caller,
    owner: event.args.owner,
    receiver: event.args.receiver,
    assets: event.args.assets,
    shares: event.args.shares,
  });
});
