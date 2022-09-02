import { TransferHandler } from "../generated/OKPC";
import { OkpcOwnerKind } from "../generated/schema";

const handleTransfer: TransferHandler = async (event, context) => {
  const { OkpcToken, OkpcOwner } = context.entities;
  const { to, from, tokenId } = event.params;

  await OkpcToken.upsert({
    id: tokenId.toNumber().toString(),
    owner: to,
    lastOwner: from,
  });

  await OkpcOwner.upsert({
    id: tokenId.toNumber().toString(),
    address: to,
    kind: Math.random() > 0.5 ? OkpcOwnerKind.Good : OkpcOwnerKind.Bad,
  });
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
