import { ponder } from "@/generated";

ponder.on("ERC1155:TransferSingle", async ({ event, context }) => {
  const { Account, TokenBalance, TransferEvent } = context.db;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: event.args.from,
  });

  await TokenBalance.upsert({
    id: `${event.args.id}-${event.args.from}`,
    create: {
      tokenId: event.args.id,
      ownerId: event.args.from,
      balance: -event.args.amount,
    },
    update: ({ current }) => ({
      tokenId: event.args.id,
      ownerId: event.args.from,
      balance: current.balance - event.args.amount,
    }),
  });

  // Create an Account for the recipient, or update the balance if it already exists.
  await Account.upsert({
    id: event.args.to,
  });

  await TokenBalance.upsert({
    id: `${event.args.id}-${event.args.to}`,
    create: {
      tokenId: event.args.id,
      ownerId: event.args.to,
      balance: event.args.amount,
    },
    update: ({ current }) => ({
      tokenId: event.args.id,
      ownerId: event.args.to,
      balance: current.balance + event.args.amount,
    }),
  });

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      fromId: event.args.from,
      toId: event.args.to,
      tokenId: event.args.id,
      timestamp: Number(event.block.timestamp),
    },
  });
});

ponder.on("ERC1155:TransferBatch", async ({ event, context }) => {
  const { Account, TokenBalance, TransferEvent } = context.db;

  await Account.upsert({
    id: event.args.from,
  });

  await Account.upsert({
    id: event.args.to,
  });

  for (let i = 0; i < event.args.ids.length; i++) {
    const id = event.args.ids[i]!;
    const amount = event.args.amounts[i]!;

    await TokenBalance.upsert({
      id: `${id}-${event.args.from}`,
      create: {
        tokenId: id,
        ownerId: event.args.from,
        balance: -amount,
      },
      update: ({ current }) => ({
        tokenId: id,
        ownerId: event.args.from,
        balance: current.balance - amount,
      }),
    });

    await TokenBalance.upsert({
      id: `${id}-${event.args.to}`,
      create: {
        tokenId: id,
        ownerId: event.args.to,
        balance: amount,
      },
      update: ({ current }) => ({
        tokenId: id,
        ownerId: event.args.to,
        balance: current.balance + amount,
      }),
    });

    await TransferEvent.create({
      id: `${event.log.id}-${i}`,
      data: {
        fromId: event.args.from,
        toId: event.args.to,
        tokenId: id,
        timestamp: Number(event.block.timestamp),
      },
    });
  }
});
