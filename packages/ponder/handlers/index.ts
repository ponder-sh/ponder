import {
  AlignmentVoteHandler,
  ButtonInputHandler,
  EthPlaysV0Handlers,
  SetConfigHandler,
} from "../generated/EthPlaysV0";

const handleAlignmentVote: AlignmentVoteHandler = async (params, context) => {
  const { db } = context;
  const { from, vote, alignment } = params;

  await db("FeedItem").insert({
    timestamp: 123,
    feedIndex: 456,
    type: "AlignmentVote",
    from: from,
    vote: vote,
  });
};

const handleButtonInput: ButtonInputHandler = async (params) => {
  const { from, buttonIndex, inputIndex } = params;
};

const handleSetConfig: SetConfigHandler = async (params) => {
  const { config } = params;
};

const handlers: EthPlaysV0Handlers = {
  AlignmentVote: handleAlignmentVote,
  ButtonInput: handleButtonInput,
  SetConfig: handleSetConfig,
};

export default handlers;
