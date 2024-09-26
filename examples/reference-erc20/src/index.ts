import { ponder } from "@/generated";
import { eq } from "drizzle-orm";
import * as schema from "../ponder.schema";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  // Create an "account" for the sender, or update the balance if it already exists.

  const from = await context.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.address, event.args.from));

  if (from.length === 0) {
    await context.db.insert(schema.account).values({
      address: event.args.from,
      balance: 0n,
      isOwner: false,
    });
  } else {
    await context.db.update(schema.account).set({
      balance: from[0]!.balance - event.args.amount,
    });
  }

  // Create an "account" for the recipient, or update the balance if it already exists.

  const to = await context.db
    .select()
    .from(schema.account)
    .where(eq(schema.account.address, event.args.to));

  if (to.length === 0) {
    await context.db.insert(schema.account).values({
      address: event.args.to,
      balance: 0n,
      isOwner: false,
    });
  } else {
    await context.db.update(schema.account).set({
      balance: to[0]!.balance + event.args.amount,
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
  await context.db
    .insert(schema.allowance)
    .values({
      owner: event.args.owner,
      spender: event.args.spender,
      amount: event.args.amount,
    })
    .onConflictDoUpdate({
      target: [schema.allowance.spender, schema.allowance.owner],
      set: {
        amount: event.args.amount,
      },
    });

  // add row to "approval_event".
  await context.db.insert(schema.approvalEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
