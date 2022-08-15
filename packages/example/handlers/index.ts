import {
  AlignmentVoteHandler,
  ButtonInputHandler,
} from "../generated/EthPlaysV0";

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

const handleButtonInput: ButtonInputHandler = async (params, context) => {
  const { FeedItem } = context.entities;

  const { from, buttonIndex, inputIndex } = params;

  await FeedItem.insert({
    timestamp: 123,
    feedIndex: 789,
    type: "ButtonInput",
    from: from,
    buttonIndex: buttonIndex,
    inputIndex: inputIndex,
  });
};

const EthPlaysV0 = {
  AlignmentVote: handleAlignmentVote,
  ButtonInput: handleButtonInput,
};

export default {
  EthPlaysV0: EthPlaysV0,
};
