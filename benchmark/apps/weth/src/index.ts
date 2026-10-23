import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  supply,
  transferEvent,
} from "ponder:schema";

// Balances start at zero because indexing starts at the chain tip; they are
// relative to the start block, which is fine for a memory workload.

ponder.on("WETH:Transfer", async ({ event, context }) => {
  await context.db
    .insert(account)
    .values({
      address: event.args.src,
      balance: -event.args.wad,
      transferCount: 1,
    })
    .onConflictDoUpdate((row) => ({
      balance: row.balance - event.args.wad,
      transferCount: row.transferCount + 1,
    }));

  await context.db
    .insert(account)
    .values({
      address: event.args.dst,
      balance: event.args.wad,
      transferCount: 1,
    })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + event.args.wad,
      transferCount: row.transferCount + 1,
    }));

  await context.db.insert(transferEvent).values({
    id: event.id,
    amount: event.args.wad,
    timestamp: Number(event.block.timestamp),
    from: event.args.src,
    to: event.args.dst,
  });
});

ponder.on("WETH:Approval", async ({ event, context }) => {
  await context.db
    .insert(allowance)
    .values({
      owner: event.args.src,
      spender: event.args.guy,
      amount: event.args.wad,
    })
    .onConflictDoUpdate({ amount: event.args.wad });

  await context.db.insert(approvalEvent).values({
    id: event.id,
    amount: event.args.wad,
    timestamp: Number(event.block.timestamp),
    owner: event.args.src,
    spender: event.args.guy,
  });
});

ponder.on("WETH:Deposit", async ({ event, context }) => {
  await context.db
    .insert(supply)
    .values({ id: "weth", deposited: event.args.wad, withdrawn: 0n })
    .onConflictDoUpdate((row) => ({
      deposited: row.deposited + event.args.wad,
    }));
});

ponder.on("WETH:Withdrawal", async ({ event, context }) => {
  await context.db
    .insert(supply)
    .values({ id: "weth", deposited: 0n, withdrawn: event.args.wad })
    .onConflictDoUpdate((row) => ({
      withdrawn: row.withdrawn + event.args.wad,
    }));
});
