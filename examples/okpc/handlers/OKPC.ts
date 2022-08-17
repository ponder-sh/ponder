import { TransferHandler } from "../generated/OKPC";

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
    })
    .onConflict("id")
    .merge();
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
