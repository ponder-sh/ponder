import { ponder } from "@/generated";

ponder.on("AdventureGold:Transfer", async ({ event, context }) => {
  const { Account, TransferEvent } = context.entities;

  // Create an Account for the sender, or update the balance if it already exists.
  const sender = await Account.findUnique({ id: event.params.from });
  if (!sender) {
    await Account.create({
      id: event.params.from,
      data: {
        balance: BigInt(0),
        isOwner: false,
      },
    });
  } else {
    await Account.update({
      id: event.params.from,
      data: {
        balance: sender.balance - event.params.value,
      },
    });
  }

  // Create an Account for the recipient, or update the balance if it already exists.
  const recipient = await Account.findUnique({ id: event.params.to });
  if (!recipient) {
    await Account.create({
      id: event.params.to,
      data: {
        balance: event.params.value,
        isOwner: false,
      },
    });
  } else {
    await Account.update({
      id: event.params.to,
      data: {
        balance: recipient.balance + event.params.value,
      },
    });
  }

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      from: event.params.from,
      to: event.params.to,
      amount: event.params.value,
      timestamp: Number(event.block.timestamp),
    },
  });
});

ponder.on("AdventureGold:Approval", async ({ event, context }) => {
  const { Approval, ApprovalEvent } = context.entities;

  const approvalId = `${event.params.owner}-${event.params.spender}`;

  // Create or update the Approval.
  await Approval.upsert({
    id: approvalId,
    create: {
      owner: event.params.owner,
      spender: event.params.spender,
      amount: event.params.value,
    },
    update: {
      amount: event.params.value,
    },
  });

  // Create a TransferEvent.
  await ApprovalEvent.create({
    id: event.log.id,
    data: {
      owner: event.params.owner,
      spender: event.params.spender,
      amount: event.params.value,
      timestamp: Number(event.block.timestamp),
    },
  });
});

ponder.on("AdventureGold:OwnershipTransferred", async ({ event, context }) => {
  const { Account } = context.entities;

  await Account.upsert({
    id: event.params.previousOwner,
    create: {
      balance: BigInt(0),
      isOwner: false,
    },
    update: {
      isOwner: false,
    },
  });

  await Account.upsert({
    id: event.params.newOwner,
    create: {
      balance: BigInt(0),
      isOwner: true,
    },
    update: {
      isOwner: true,
    },
  });
});
