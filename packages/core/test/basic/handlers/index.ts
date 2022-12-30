const handleArtGobbled = async (event: any, context: any) => {
  console.log({ event });

  // await context.entities.GobbledArt.insert(
  //   `${event.params.nft}-${event.params.id}`,
  //   {
  //     user: event.params.user,
  //   }
  // );
};

export default {
  ArtGobblers: {
    ArtGobbled: handleArtGobbled,
  },
};
