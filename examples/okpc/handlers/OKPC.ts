import { TransferHandler } from "../generated/OKPC";

const handleTransfer: TransferHandler = async (event, context) => {
  const { OkpcToken } = context.entities;
  const { to, tokenId } = event.params;

  const existingOkpcToken = await OkpcToken()
    .where({
      id: tokenId.toNumber().toString(),
    })
    .first();

  if (existingOkpcToken) {
    await OkpcToken()
      .where({
        id: tokenId.toNumber().toString(),
      })
      .update({
        owner: to,
      });
  } else {
    await OkpcToken().insert({
      id: tokenId.toNumber().toString(),
      owner: to,
    });
  }
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
