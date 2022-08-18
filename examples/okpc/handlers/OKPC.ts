import { TransferHandler } from "../generated/OKPC";
import { OkpcOwnerKind } from "../generated/schema";

const handleTransfer: TransferHandler = async (event, context) => {
  const { OkpcToken, OkpcOwner } = context.entities;
  const { to, from, tokenId } = event.params;

  await OkpcToken()
    .insert({
      id: tokenId.toNumber().toString(),
      owner: to,
      lastOwner: from,
    })
    .onConflict("id")
    .merge();

  await OkpcOwner()
    .insert({
      id: tokenId.toNumber().toString(),
      address: to,
      kind: Math.random() > 0.5 ? OkpcOwnerKind.Good : OkpcOwnerKind.Bad,
    })
    .onConflict("id")
    .merge();
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
