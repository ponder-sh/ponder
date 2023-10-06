import { ponder } from "../generated/index.js";

ponder.on(
  "BaseRegistrarImplementation:Transfer",
  async ({ event, context }) => {
    const { EnsNft, Account } = context.entities;

    await EnsNft.upsert({
      id: event.params.tokenId.toString(),
      create: {
        owner: event.params.to,
        labelHash: "0x" + event.params.tokenId.toString(16),
        transferredAt: Number(event.block.timestamp),
        stringArray: ["123", "abc"],
        intArray: [123, 456],
      },
      update: {
        owner: event.params.to,
        labelHash: "0x" + event.params.tokenId.toString(16),
        transferredAt: Number(event.block.timestamp),
      },
    });

    await Account.upsert({
      id: event.params.from,
      create: {
        lastActive: Number(event.block.timestamp),
      },
      update: {
        lastActive: Number(event.block.timestamp),
      },
    });

    await Account.upsert({
      id: event.params.to,
      create: {
        lastActive: Number(event.block.timestamp),
      },
      update: {
        lastActive: Number(event.block.timestamp),
      },
    });
  }
);
