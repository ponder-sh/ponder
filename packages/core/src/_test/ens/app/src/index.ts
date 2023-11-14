import { ponder } from "@/generated";

ponder.on(
  "BaseRegistrarImplementation:Transfer",
  async ({ event, context }) => {
    const { EnsNft, Account } = context.models;

    await EnsNft.upsert({
      id: event.args.tokenId.toString(),
      create: {
        ownerId: event.args.to,
        labelHash: "0x" + event.args.tokenId.toString(16),
        transferredAt: Number(event.block.timestamp),
        stringArray: ["123", "abc"],
        intArray: [123, 456],
      },
      update: {
        ownerId: event.args.to,
        labelHash: "0x" + event.args.tokenId.toString(16),
        transferredAt: Number(event.block.timestamp),
      },
    });

    await Account.upsert({
      id: event.args.from,
      create: {
        lastActive: Number(event.block.timestamp),
      },
      update: {
        lastActive: Number(event.block.timestamp),
      },
    });

    await Account.upsert({
      id: event.args.to,
      create: {
        lastActive: Number(event.block.timestamp),
      },
      update: {
        lastActive: Number(event.block.timestamp),
      },
    });
  },
);
