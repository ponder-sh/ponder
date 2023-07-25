import { ponder } from "@/generated";

ponder.on("SmolBrain:Transfer", async ({ event, context }) => {
  const { Account, Token, TransferEvent } = context.entities;

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
      owner: event.params.to,
    },
    update: {
      owner: event.params.to,
    },
  });

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      from: event.params.from,
      to: event.params.to,
      token: event.params.tokenId,
      timestamp: Number(event.block.timestamp),
    },
  });
});
