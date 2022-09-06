import { TransferHandler } from "../generated/OKPC";
import { OkpcOwnerTrait } from "../generated/schema";

const handleTransfer: TransferHandler = async (event, context) => {
  const { OkpcToken, OkpcOwner } = context.entities;
  const { to, from, tokenId } = event.params;

  await OkpcToken.upsert({
    id: tokenId.toNumber().toString(),
    tokenId: tokenId.toNumber(),
    owner: to,
  });

  await OkpcOwner.upsert({
    id: from,
    traits: [OkpcOwnerTrait.Bad],
  });

  await OkpcOwner.upsert({
    id: to,
    traits: [OkpcOwnerTrait.Good],
  });
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
