import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  // // Create an Account for the sender, or update the balance if it already exists.
  // await Account.upsert({
  //   id: event.args.from,
  //   create: {
  //     balance: BigInt(0),
  //     isOwner: false,
  //   },
  //   update: ({ current }) => ({
  //     balance: current.balance - event.args.amount,
  //   }),
  // });

  // // Create an Account for the recipient, or update the balance if it already exists.
  // await Account.upsert({
  //   id: event.args.to,
  //   create: {
  //     balance: event.args.amount,
  //     isOwner: false,
  //   },
  //   update: ({ current }) => ({
  //     balance: current.balance + event.args.amount,
  //   }),
  // });

  // Create a TransferEvent.
  await context.db.insert(schema.transferEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    from: event.args.from,
    to: event.args.to,
  });
});

ponder.on("ERC20:Approval", async ({ event, context }) => {
  // // Create or update the Allowance.
  // await Allowance.upsert({
  //   id: allowanceId,
  //   create: {
  //     ownerId: event.args.owner,
  //     spenderId: event.args.spender,
  //     amount: event.args.amount,
  //   },
  //   update: {
  //     amount: event.args.amount,
  //   },
  // });

  // Create an ApprovalEvent.
  await context.db.insert(schema.approvalEvent).values({
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
    owner: event.args.owner,
    spender: event.args.spender,
  });
});
