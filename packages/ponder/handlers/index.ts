import {
  AlignmentVoteHandler,
  ButtonInputHandler,
  EthPlaysV0Handlers,
  SetConfigHandler,
} from "../generated/EthPlaysV0";

const handleAlignmentVote: AlignmentVoteHandler = (params) => {
  const { from, vote, alignment } = params;
  // console.log("processing alignment vote:", { from, vote, alignment });
};

const handleButtonInput: ButtonInputHandler = (params) => {
  const { from, buttonIndex, inputIndex } = params;
  // console.log("processing button input:", { from, buttonIndex, inputIndex });
};

const handleSetConfig: SetConfigHandler = (params) => {
  const { config } = params;
  // console.log("processing set config:", { config });
};

const handlers: EthPlaysV0Handlers = {
  AlignmentVote: handleAlignmentVote,
  ButtonInput: handleButtonInput,
  SetConfig: handleSetConfig,
};

export default handlers;
