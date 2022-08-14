import { AlignmentVoteHandler } from "../generated/EthPlaysV0";

const handleAlignmentVote: AlignmentVoteHandler = async (params, context) => {
  const { FeedItem } = context.entities;
  const { EthPlaysV0 } = context.contracts;

  const { from, vote, alignment } = params;

  await FeedItem.insert({
    timestamp: 123,
    feedIndex: 456,
    type: "AlignmentVote",
    from: from,
    vote: vote,
  });
};

const EthPlaysV0 = {
  AlignmentVote: handleAlignmentVote,
};

export default {
  EthPlaysV0: EthPlaysV0,
};
