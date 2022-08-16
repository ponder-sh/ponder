import {
  AlignmentVoteHandler,
  ButtonInputHandler,
} from "../generated/EthPlaysV0";

const handleAlignmentVote: AlignmentVoteHandler = async (event, context) => {
  const { FeedItem } = context.entities;
  const { EthPlaysV0 } = context.contracts;

  const { from, vote, alignment } = event.params;

  await FeedItem.insert({
    timestamp: 123,
    feedIndex: 42,
    type: "AlignmentVote",
    from: from,
    vote: vote,
  });
};

const handleButtonInput: ButtonInputHandler = async (event, context) => {
  const { FeedItem } = context.entities;

  const { from, buttonIndex, inputIndex } = event.params;

  await FeedItem.insert({
    timestamp: 121233,
    feedIndex: 789,
    type: "ButtonInput",
    from: from,
    vote: false,
    buttonIndex: buttonIndex.toNumber() ** 2,
    inputIndex: inputIndex.toNumber(),
  });
};

const EthPlaysV0 = {
  AlignmentVote: handleAlignmentVote,
  ButtonInput: handleButtonInput,
};

export { EthPlaysV0 };
