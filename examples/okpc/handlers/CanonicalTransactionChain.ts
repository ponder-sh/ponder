import { SequencerBatchAppendedHandler } from "../generated/CanonicalTransactionChain";

const handleSequencerBatchAppended: SequencerBatchAppendedHandler = async (
  event,
  context
) => {
  // const { block, transaction } = event;
  const { OKPC } = context.contracts;

  await OKPC.tokenURI(444, {
    blockTag: event.block.number,
  });
};

const CanonicalTransactionChain = {
  SequencerBatchAppended: handleSequencerBatchAppended,
};

export { CanonicalTransactionChain };
