import { ponder } from "@/generated";

ponder.on("ArtGobblers:ArtGobbled", async ({ event, context }) => {
  const { GobbledArt } = context.entities;

  await GobbledArt.create({
    id: `${event.params.nft}-${event.params.id}`,
    data: {
      user: event.params.user,
    },
  });

  await GobbledArt.create({
    id: `${event.params.nft}-${event.params.id}`,
    data: {
      user: event.params.user,
    },
  });
});
