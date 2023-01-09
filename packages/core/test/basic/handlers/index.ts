const handleArtGobbled = async (event: any, context: any) => {
  await context.entities.GobbledArt.insert(
    `${event.params.nft}-${event.params.id}`,
    {
      user: event.params.user,
    }
  );
};

export default {
  ArtGobblers: {
    ArtGobbled: handleArtGobbled,
  },
};
