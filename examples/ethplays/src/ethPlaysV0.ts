import { BigInt, Bytes } from "@graphprotocol/graph-ts";

import {
  // Gameplay events
  AlignmentVote,
  InputVote,
  ButtonInput,
  Chat,
  RareCandy,
  // Auction events
  NewControlBid,
  Control,
  // Admin events
  SetIsActive,
  SetAlignmentDecayRate,
  SetChaosVoteReward,
  SetOrderDuration,
  SetChaosInputRewardCooldown,
  SetChaosInputReward,
  SetOrderInputReward,
  SetChatCost,
  SetRareCandyCost,
  SetControlAuctionDuration,
  SetControlDuration,
} from "../generated/EthPlaysV0/EthPlaysV0";

import {
  buildFeedItemEntity,
  buildGameStateEntity,
  buildPlayerEntity,
} from "./utils";

// Gameplay events

export function handleAlignmentVote(event: AlignmentVote): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.alignment = event.params.alignment;
  gameStateEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "AlignmentVote";
  feedItemEntity.from = event.params.from;
  feedItemEntity.vote = event.params.vote;
  feedItemEntity.save();

  const playerEntity = buildPlayerEntity(event.params.from.toHexString());
  playerEntity.alignmentVoteCount = playerEntity.alignmentVoteCount + 1;
  playerEntity.alignmentVoteTimestamp = event.block.timestamp.toU32();
  playerEntity.save();
}

export function handleInputVote(event: InputVote): void {
  const gameStateEntity = buildGameStateEntity();
  const buttonIndex = event.params.buttonIndex.toU32();
  const newInputVotes = gameStateEntity.orderVotes.slice(0);
  newInputVotes[buttonIndex] = newInputVotes[buttonIndex] + 1;
  gameStateEntity.orderVotes = newInputVotes;
  gameStateEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "InputVote";
  feedItemEntity.from = event.params.from;
  feedItemEntity.inputIndex = event.params.inputIndex.toU32();
  feedItemEntity.buttonIndex = event.params.buttonIndex.toU32();
  feedItemEntity.save();

  const playerEntity = buildPlayerEntity(event.params.from.toHexString());
  playerEntity.inputVoteIndex = event.params.inputIndex.toU32();
  playerEntity.save();
}

export function handleButtonInput(event: ButtonInput): void {
  const gameStateEntity = buildGameStateEntity();

  const isOrderButtonInput =
    gameStateEntity.alignment.toI32() > 0 &&
    event.block.timestamp.toI32() >=
      gameStateEntity.inputTimestamp + gameStateEntity.orderDuration;

  gameStateEntity.inputTimestamp = event.block.timestamp.toU32();
  gameStateEntity.inputIndex = event.params.inputIndex;
  gameStateEntity.orderVotes = [0, 0, 0, 0, 0, 0, 0, 0];
  gameStateEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = isOrderButtonInput ? "OrderButtonInput" : "ButtonInput";
  feedItemEntity.from = event.params.from;
  feedItemEntity.inputIndex = event.params.inputIndex.toU32();
  feedItemEntity.buttonIndex = event.params.buttonIndex.toU32();
  feedItemEntity.save();

  const playerEntity = buildPlayerEntity(event.params.from.toHexString());
  if (
    event.block.timestamp.toI32() >
    playerEntity.chaosInputTimestamp + gameStateEntity.chaosInputRewardCooldown
  ) {
    playerEntity.chaosInputTimestamp = event.block.timestamp.toU32();
    playerEntity.save();
  }
}

// Redeem events

export function handleChat(event: Chat): void {
  const gameStateEntity = buildGameStateEntity();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "Chat";
  feedItemEntity.from = event.params.from;
  feedItemEntity.message = event.params.message;
  feedItemEntity.save();

  const playerEntity = buildPlayerEntity(event.params.from.toHexString());
  playerEntity.chatCount = playerEntity.chatCount + 1;
  playerEntity.score = playerEntity.score.plus(gameStateEntity.chatCost);
  playerEntity.save();
}

export function handleRareCandy(event: RareCandy): void {
  const gameStateEntity = buildGameStateEntity();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "RareCandy";
  feedItemEntity.from = event.params.from;
  feedItemEntity.count = event.params.count.toU32();
  feedItemEntity.save();

  const playerEntity = buildPlayerEntity(event.params.from.toHexString());
  playerEntity.rareCandyCount += event.params.count.toU32();
  playerEntity.score = playerEntity.score.plus(
    gameStateEntity.rareCandyCost
      .times(event.params.count)
      .times(BigInt.fromU32(2))
  );
  playerEntity.save();
}

// Auction events

export function handleNewControlBid(event: NewControlBid): void {
  const gameStateEntity = buildGameStateEntity();
  if (gameStateEntity.bestControlBidFrom.equals(Bytes.empty())) {
    gameStateEntity.controlAuctionStartTimestamp = event.block.timestamp.toU32();
  }
  gameStateEntity.bestControlBidFrom = event.params.from;
  gameStateEntity.bestControlBidAmount = event.params.amount;
  gameStateEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "NewControlBid";
  feedItemEntity.from = event.params.from;
  feedItemEntity.amount = event.params.amount;
  feedItemEntity.save();
}

export function handleControl(event: Control): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.controlAuctionEndTimestamp = event.block.timestamp.toU32();

  const playerEntity = buildPlayerEntity(event.params.from.toHexString());
  playerEntity.controlCount = playerEntity.controlCount + 1;
  playerEntity.score = playerEntity.score.plus(
    gameStateEntity.bestControlBidAmount
  );
  playerEntity.save();

  gameStateEntity.controlAddress = event.params.from;

  gameStateEntity.bestControlBidFrom = Bytes.empty();
  gameStateEntity.bestControlBidAmount = BigInt.fromU32(0);
  gameStateEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "Control";
  feedItemEntity.from = event.params.from;
  feedItemEntity.save();
}

// Admin events

export function handleSetIsActive(event: SetIsActive): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.isActive = event.params.isActive;
  gameStateEntity.save();
}

export function handleSetAlignmentDecayRate(
  event: SetAlignmentDecayRate
): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.alignmentDecayRate = event.params.alignmentDecayRate.toU32();
  gameStateEntity.save();
}

export function handleSetChaosVoteReward(event: SetChaosVoteReward): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.chaosVoteReward = event.params.chaosVoteReward;
  gameStateEntity.save();
}

export function handleSetOrderDuration(event: SetOrderDuration): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.orderDuration = event.params.orderDuration.toU32();
  gameStateEntity.save();
}

export function handleSetChaosInputRewardCooldown(
  event: SetChaosInputRewardCooldown
): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.chaosInputRewardCooldown = event.params.chaosInputRewardCooldown.toU32();
  gameStateEntity.save();
}

export function handleSetChaosInputReward(event: SetChaosInputReward): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.chaosInputReward = event.params.chaosInputReward;
  gameStateEntity.save();
}

export function handleSetOrderInputReward(event: SetOrderInputReward): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.orderInputReward = event.params.orderInputReward;
  gameStateEntity.save();
}

export function handleSetChatCost(event: SetChatCost): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.chatCost = event.params.chatCost;
  gameStateEntity.save();
}

export function handleSetRareCandyCost(event: SetRareCandyCost): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.rareCandyCost = event.params.rareCandyCost;
  gameStateEntity.save();
}

export function handleSetControlAuctionDuration(
  event: SetControlAuctionDuration
): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.controlAuctionDuration = event.params.controlAuctionDuration.toU32();
  gameStateEntity.save();
}

export function handleSetControlDuration(event: SetControlDuration): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.controlDuration = event.params.controlDuration.toU32();
  gameStateEntity.save();
}
