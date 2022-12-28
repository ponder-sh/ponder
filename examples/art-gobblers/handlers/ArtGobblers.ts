import { ArtGobbledHandler } from "../generated/handlers";

const handleArtGobbled: ArtGobbledHandler = async (event, context) => {
  await context.entities.GobbledArt.insert(
    `${event.params.nft}-${event.params.id}`,
    {
      user: event.params.user,
    }
  );
};

export const ArtGobblers = {
  ArtGobbled: handleArtGobbled,
};
