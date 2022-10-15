import { SequencerBatchAppendedHandler } from "../generated/CanonicalTransactionChain";
import { OkpcOwnerTrait } from "../generated/schema";

const handleSequencerBatchAppended: SequencerBatchAppendedHandler = async (
  event,
  context
) => {
  const { block, transaction } = event;
  const { OKPC } = context.contracts;
  const { OkpcOwner } = context.entities;

  await OKPC.tokenURI(444, {
    blockTag: event.block.number,
  });

  await OkpcOwner.insert({
    id: transaction.hash!,
    traits: [OkpcOwnerTrait.Good, OkpcOwnerTrait.Bad],
    receivedCount: 5,
  });
};

const CanonicalTransactionChain = {
  SequencerBatchAppended: handleSequencerBatchAppended,
};

export { CanonicalTransactionChain };
