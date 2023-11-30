import { ponder } from "@/generated";

ponder.on("RocketTokenRETH:Transfer", async ({ event, context }) => {
  const { Account, TransferEvent } = context.db;

  // Create an Account for the sender, or update the balance if it already exists.
  const sender = await Account.findUnique({ id: event.args.from });
  if (!sender) {
    await Account.create({
      id: event.args.from,
      data: {
        balance: BigInt(0),
        isOwner: false,
      },
    });
  } else {
    await Account.update({
      id: event.args.from,
      data: {
        balance: sender.balance - event.args.value,
      },
    });
  }

  // Create an Account for the recipient, or update the balance if it already exists.
  const recipient = await Account.findUnique({ id: event.args.to });
  if (!recipient) {
    await Account.create({
      id: event.args.to,
      data: {
        balance: event.args.value,
        isOwner: false,
      },
    });
  } else {
    await Account.update({
      id: event.args.to,
      data: {
        balance: recipient.balance + event.args.value,
      },
    });
  }

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

ponder.on("RocketTokenRETH:Approval", async ({ event, context }) => {
  const { Approval, ApprovalEvent } = context.db;

  const approvalId =
    `${event.args.owner}-${event.args.spender}` as `0x${string}`;

  // Create or update the Approval.
  await Approval.upsert({
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

  // Create a TransferEvent.
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
