import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  // Create an "account" for the sender, or update the balance if it already exists.

  const from = await context.db.find(schema.account, {
    address: event.args.from,
  });

  if (from === undefined) {
    await context.db.insert(schema.account).values({
      address: event.args.from,
      balance: 0n,
      isOwner: false,
    });
  } else {
    await context.db.update(schema.account, { address: event.args.from }).set({
      balance: from.balance - event.args.amount,
    });
  }

  // Create an "account" for the recipient, or update the balance if it already exists.

  const to = await context.db.find(schema.account, {
    address: event.args.to,
  });

  if (to === undefined) {
    await context.db.insert(schema.account).values({
      address: event.args.to,
      balance: 0n,
      isOwner: false,
    });
  } else {
    await context.db.update(schema.account, { address: event.args.to }).set({
      balance: to.balance + event.args.amount,
    });
  }

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

  const allowance = await context.db.find(schema.allowance, {
    spender: event.args.spender,
    owner: event.args.owner,
  });

  if (allowance === undefined) {
    await context.db.insert(schema.allowance).values({
      owner: event.args.owner,
      spender: event.args.spender,
      amount: event.args.amount,
    });
  } else {
    await context.db
      .update(schema.allowance, {
        spender: event.args.spender,
        owner: event.args.owner,
      })
      .set({
        amount: event.args.amount,
      });
  }

  // add row to "approval_event".
  await context.db.insert(schema.approvalEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
