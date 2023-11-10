import { ponder } from "@/generated";

ponder.on("ArtGobblers:ArtGobbled", async ({ event, context }) => {
  const { GobbledArt } = context.models;

  await GobbledArt.create({
    id: `${event.params.nft}-${event.params.id}`,
    data: {
      user: event.params.user,
    },
  });
});
