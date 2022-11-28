import { ArtGobbledHandler } from "../generated/handlers";

const handleArtGobbled: ArtGobbledHandler = async (event, context) => {
  console.log("Art Gobbled!");

  context.entities.GobbledArt.insert(`${event.params.nft}-${event.params.id}`, {
    id: `${event.params.nft}-${event.params.id}`,
    user: event.params.user,
  });

  return;
};

export const ArtGobblers = {
  ArtGobbled: handleArtGobbled,
};
