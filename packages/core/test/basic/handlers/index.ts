const handleTransfer = async (event: any, context: any) => {
  await context.entities.EnsNft.upsert(event.params.tokenId.toString(), {
    owner: event.params.to,
    labelHash: event.params.tokenId.toHexString(),
    transferredAt: event.block.timestamp,
  });

  await context.entities.Account.upsert(event.params.from, {
    lastActive: event.block.timestamp,
  });

  await context.entities.Account.upsert(event.params.to, {
    lastActive: event.block.timestamp,
  });
};

export default {
  BaseRegistrarImplementation: {
    Transfer: handleTransfer,
  },
};
