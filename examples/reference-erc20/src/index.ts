import { ponder } from "ponder:registry";
import {
  account,
  allowance,
  approvalEvent,
  transferEvent,
} from "ponder:schema";
import { sql } from "ponder";

let prepareInsertAllowance: any;
let prepareInsertTransfer: any;

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  // await context.db.sql
  //   .insert(account)
  //   .values({ address: event.args.from, balance: 0n, isOwner: false })
  //   .onConflictDoUpdate((row) => ({
  //     balance: row.balance - event.args.amount,
  //   }));
  // await context.db
  //   .insert(account)
  //   .values({ address: event.args.to, balance: 0n, isOwner: false })
  //   .onConflictDoUpdate((row) => ({
  //     balance: row.balance + event.args.amount,
  //   }));
  // add row to "transfer_event".
  // await context.db.sql.insert(transferEvent).values({
  //   id: event.log.id,
  //   amount: event.args.amount,
  //   timestamp: Number(event.block.timestamp),
  //   from: event.args.from,
  //   to: event.args.to,
  // });

  if (prepareInsertTransfer === undefined) {
    prepareInsertTransfer = context.db.sql
      .insert(transferEvent)
      .values({
        id: sql.placeholder("id"),
        amount: sql.placeholder("amount"),
        timestamp: sql.placeholder("timestamp"),
        from: sql.placeholder("from"),
        to: sql.placeholder("to"),
      })
      .prepare("insert_transfer");
  }

  await prepareInsertTransfer.execute({
    id: event.log.id,
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });
});

ponder.on("ERC20:Approval", async ({ event, context }) => {
  if (prepareInsertAllowance === undefined) {
    prepareInsertAllowance = context.db.sql
      .insert(allowance)
      .values({
        spender: sql.placeholder("spender"),
        owner: sql.placeholder("owner"),
        amount: sql.placeholder("amount"),
      })
      .onConflictDoUpdate({
        target: [allowance.spender, allowance.owner],
        set: { amount: sql.placeholder("amount") },
      })
      .prepare("insert_allowance");
  }

  await prepareInsertAllowance.execute({
    spender: event.args.spender,
    owner: event.args.owner,
    amount: event.args.amount,
  });

  // // upsert "allowance".
  // await context.db.sql
  //   .insert(allowance)
  //   .values({
  //     spender: event.args.spender,
  //     owner: event.args.owner,
  //     amount: event.args.amount,
  //   })
  //   .onConflictDoUpdate({
  //     target: [allowance.spender, allowance.owner],
  //     set: { amount: event.args.amount },
  //   });

  // // add row to "approval_event".
  // await context.db.sql.insert(approvalEvent).values({
  //   id: event.log.id,
  //   amount: event.args.amount,
  //   timestamp: Number(event.block.timestamp),
  //   owner: event.args.owner,
  //   spender: event.args.spender,
  // });
});
