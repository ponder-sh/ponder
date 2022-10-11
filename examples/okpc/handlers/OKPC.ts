import { TransferHandler } from "../generated/OKPC";
import { OkpcOwnerTrait } from "../generated/schema";

const handleTransfer: TransferHandler = async (event, context) => {
  const { block, transaction } = event;
  const { OkpcToken, OkpcOwner } = context.entities;
  const { to, from, tokenId } = event.params;

  const token = await OkpcToken.get(tokenId.toNumber().toString());
  if (token) {
    await OkpcToken.update({
      id: tokenId.toNumber().toString(),
      tokenId: block.nonce,
      owner: to,
    });
  } else {
    await OkpcToken.insert({
      id: tokenId.toNumber().toString(),
      tokenId: tokenId.toNumber().toString(),
      owner: to,
    });
  }

  const existingSender = await OkpcOwner.get(from);
  if (existingSender) {
    await OkpcOwner.update({
      id: from,
      traits: [OkpcOwnerTrait.Bad],
    });
  } else {
    await OkpcOwner.insert({
      id: from,
      traits: [OkpcOwnerTrait.Bad],
    });
  }

  const existingRecipient = await OkpcOwner.get(to);
  if (existingRecipient) {
    await OkpcOwner.update({
      id: to,
      receivedCount: (existingRecipient.receivedCount || 0) + 1,
    });
  } else {
    await OkpcOwner.insert({
      id: to,
      traits: [OkpcOwnerTrait.Good],
      receivedCount: 0,
    });
  }
};

const OKPC = {
  Transfer: handleTransfer,
};

export { OKPC };
