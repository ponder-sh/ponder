import { ponder } from "@/generated";

ponder.on("SmolBrain:Transfer", async ({ event, context }) => {
  const { Account, Token, TransferEvent } = context.models;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: event.params.from,
  });

  // Create an Account for the recipient, or update the balance if it already exists.
  await Account.upsert({
    id: event.params.to,
  });

  // Create or update a Token.
  await Token.upsert({
    id: event.params.tokenId,
    create: {
      ownerId: event.params.to,
    },
    update: {
      ownerId: event.params.to,
    },
  });

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      fromId: event.params.from,
      toId: event.params.to,
      tokenId: event.params.tokenId,
      timestamp: Number(event.block.timestamp),
    },
  });
});
