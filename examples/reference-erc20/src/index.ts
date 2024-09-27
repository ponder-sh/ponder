import { ponder } from "@/generated";
import { and, eq } from "@ponder/core/db";
import * as schema from "../ponder.schema";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  // Create an "account" for the sender, or update the balance if it already exists.

  const from = await context.db.query.account.findFirst({
    where: eq(schema.account.address, event.args.from),
  });

  if (from === undefined) {
    await context.db.insert(schema.account).values({
      address: event.args.from,
      balance: 0n,
      isOwner: false,
    });
  } else {
    await context.db
      .update(schema.account)
      .set({
        balance: from.balance - event.args.amount,
      })
      .where(eq(schema.account.address, event.args.from));
  }

  // Create an "account" for the recipient, or update the balance if it already exists.

  const to = await context.db.query.account.findFirst({
    where: eq(schema.account.address, event.args.to),
  });

  if (to === undefined) {
    await context.db.insert(schema.account).values({
      address: event.args.to,
      balance: 0n,
      isOwner: false,
    });
  } else {
    await context.db
      .update(schema.account)
      .set({
        balance: to.balance + event.args.amount,
      })
      .where(eq(schema.account.address, event.args.to));
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

  const allowance = await context.db.query.allowance.findFirst({
    where: and(
      eq(schema.allowance.spender, event.args.spender),
      eq(schema.allowance.owner, event.args.owner),
    ),
  });

  if (allowance === undefined) {
    await context.db.insert(schema.allowance).values({
      owner: event.args.owner,
      spender: event.args.spender,
      amount: event.args.amount,
    });
  } else {
    await context.db
      .update(schema.allowance)
      .set({
        amount: event.args.amount,
      })
      .where(
        and(
          eq(schema.allowance.spender, event.args.spender),
          eq(schema.allowance.owner, event.args.owner),
        ),
      );
  }

  // add row to "approval_event".
  await context.db.insert(schema.approvalEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
