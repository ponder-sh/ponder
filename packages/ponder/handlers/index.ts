import {
  AlignmentVoteHandler,
  EthPlaysV0Handlers,
} from "../generated/EthPlaysV0";

const handleAlignmentVote: AlignmentVoteHandler = ({
  from,
  vote,
  alignment,
}) => {
  console.log("processing alignment vote!!", { from, vote, alignment });
  return null;
};

const handlers: EthPlaysV0Handlers = {
  AlignmentVote: handleAlignmentVote,
};

export default handlers;
