import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  transferEvent,
} from "ponder:schema";
import { erc20ABI } from "../abis/erc20ABI";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  await context.db
    .insert(account)
    .values({ address: event.args.from, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance - event.args.amount,
    }));

  await context.db
    .insert(account)
    .values({ address: event.args.to, balance: 0n, isOwner: false })
    .onConflictDoUpdate((row) => ({
      balance: row.balance + event.args.amount,
    }));

  // add row to "transfer_event".
  await context.db.insert(transferEvent).values({
    id: event.id,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });

  await context.client
    .readContract({
      abi: erc20ABI,
      address: event.log.address,
      functionName: "balanceOf",
      args: [event.args.from],
    })
    .then((result) => console.log({ balance: result }));
});

ponder.on("ERC20:Approval", async ({ event, context }) => {
  // upsert "allowance".
  await context.db
    .insert(allowance)
    .values({
      spender: event.args.spender,
      owner: event.args.owner,
      amount: event.args.amount,
    })
    .onConflictDoUpdate({ amount: event.args.amount });

  // add row to "approval_event".
  await context.db.insert(approvalEvent).values({
    id: event.id,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
