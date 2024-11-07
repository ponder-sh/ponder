import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC4626:Transfer", async ({ event, context }) => {
  // Create an Account for the sender, or update the balance if it already exists.
  await context.db
    .insert(schema.account)
    .values({ address: event.args.from, balance: 0n })
    .onConflictDoUpdate((row) => ({
      balance: row.balance - event.args.amount,
    }));

  // Create an Account for the recipient, or update the balance if it already exists.
  await context.db
    .insert(schema.account)
    .values({ address: event.args.to, balance: event.args.amount })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + event.args.amount,
    }));

  // Create a TransferEvent.
  await context.db.insert(schema.transferEvent).values({
    id: event.log.id,
    from: event.args.from,
    to: event.args.to,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("ERC4626:Approval", async ({ event, context }) => {
  // Create or update the Allowance.
  await context.db
    .insert(schema.allowance)
    .values({
      owner: event.args.owner,
      spender: event.args.spender,
      amount: event.args.amount,
    })
    .onConflictDoUpdate({ amount: event.args.amount });

  // Create an ApprovalEvent.
  await context.db.insert(schema.approvalEvent).values({
    id: event.log.id,
    owner: event.args.owner,
    spender: event.args.spender,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("ERC4626:Deposit", async ({ event, context }) => {
  await context.db.insert(schema.depositEvent).values({
    id: event.log.id,
    sender: event.args.caller,
    receiver: event.args.owner,
    assets: event.args.assets,
    shares: event.args.shares,
  });
});

ponder.on("ERC4626:Withdraw", async ({ event, context }) => {
  await context.db.insert(schema.withdrawalEvent).values({
    id: event.log.id,
    sender: event.args.caller,
    owner: event.args.owner,
    receiver: event.args.receiver,
    assets: event.args.assets,
    shares: event.args.shares,
  });
});
