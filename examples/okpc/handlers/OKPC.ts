import { TransferHandler } from "../generated/OKPC";

const handleTransfer: TransferHandler = async (event, context) => {
  const { OkpcToken } = context.entities;
  const { to, tokenId } = event.params;

  await OkpcToken()
    .insert({
      id: tokenId.toNumber().toString(),
      owner: to,
    })
    .onConflict("id")
    .merge();
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
