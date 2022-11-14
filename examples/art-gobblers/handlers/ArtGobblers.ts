import { ArtGobbledHandler } from "../generated/ArtGobblers";

const handleArtGobbled: ArtGobbledHandler = async (event, context) => {
  console.log("Art Gobbled!");

  context.entities.GobbledArt.insert({
    id: `${event.params.nft}-${event.params.id}`,
    user: event.params.user,
  });

  return;
};

export const ArtGobblers = {
  ArtGobbled: handleArtGobbled,
};
