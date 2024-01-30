import { ponder } from "@/generated";

ponder.on("ERC20:Transfer", async ({ event, context }) => {
  const { Account, TransferEvent } = context.db;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: event.args.from,
    create: {
      balance: BigInt(0),
      isOwner: false,
    },
    update: ({ current }) => ({
      balance: current.balance - event.args.value,
    }),
  });

  // Create an Account for the recipient, or update the balance if it already exists.
  await Account.upsert({
    id: event.args.to,
    create: {
      balance: event.args.value,
      isOwner: false,
    },
    update: ({ current }) => ({
      balance: current.balance + event.args.value,
    }),
  });

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      fromId: event.args.from,
      toId: event.args.to,
      amount: event.args.value,
      timestamp: Number(event.block.timestamp),
    },
  });
});

ponder.on("ERC20:Approval", async ({ event, context }) => {
  const { Allowance, ApprovalEvent } = context.db;

  const approvalId =
    `${event.args.owner}-${event.args.spender}` as `0x${string}`;

  // Create or update the Approval.
  await Allowance.upsert({
    id: approvalId,
    create: {
      ownerId: event.args.owner,
      spenderId: event.args.spender,
      amount: event.args.value,
    },
    update: {
      amount: event.args.value,
    },
  });

  // Create an ApprovalEvent.
  await ApprovalEvent.create({
    id: event.log.id,
    data: {
      ownerId: event.args.owner,
      spenderId: event.args.spender,
      amount: event.args.value,
      timestamp: Number(event.block.timestamp),
    },
  });
});
