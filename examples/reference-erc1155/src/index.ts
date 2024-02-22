import { ponder } from "@/generated";

ponder.on(
  "CurioERC1155Wrapper:TransferSingle",
  async ({ event, context }) => {
    const { Account, Token, TransferEvent } = context.db;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: event.args._from,
  });

  // Create an Account for the recipient, or update the balance if it already exists.
  await Account.upsert({
    id: event.args._to,
  });

  // Create or update a Token.
  await Token.upsert({
    id: event.args._id,
    create: {
      ownerId: event.args._to,
    },
    update: {
      ownerId: event.args._to,
    },
  });

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      fromId: event.args._from,
      toId: event.args._to,
      tokenId: event.args._id,
      timestamp: Number(event.block.timestamp),
    },
  });
  },
);

