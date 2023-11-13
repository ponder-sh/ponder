import { ponder } from "@/generated";

ponder.on(
  "BaseRegistrarImplementation:Transfer",
  async ({ event, context }) => {
    const { EnsNft, Account } = context.models;

    await EnsNft.upsert({
      id: event.params.tokenId.toString(),
      create: {
        ownerId: event.params.to,
        labelHash: "0x" + event.params.tokenId.toString(16),
        transferredAt: Number(event.block.timestamp),
        stringArray: ["123", "abc"],
        intArray: [123, 456],
      },
      update: {
        ownerId: event.params.to,
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
  },
);
