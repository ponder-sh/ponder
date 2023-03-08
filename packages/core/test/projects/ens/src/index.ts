import { ponder } from "../generated";

ponder.on(
  "BaseRegistrarImplementation:Transfer",
  async ({ event, context }) => {
    await context.entities.EnsNft.upsert(event.params.tokenId.toString(), {
      owner: event.params.to,
      labelHash: "0x" + event.params.tokenId.toString(16),
      transferredAt: Number(event.block.timestamp),
      stringArray: ["123", "abc"],
      intArray: [123, 456],
    });

    await context.entities.Account.upsert(event.params.from, {
      lastActive: Number(event.block.timestamp),
    });

    await context.entities.Account.upsert(event.params.to, {
      lastActive: Number(event.block.timestamp),
    });
  }
);
