import { BigInt, ethereum, Bytes, Address } from "@graphprotocol/graph-ts";
import { Poke } from "../generated/Poke/Poke";
import { RegistryReceiverV0 } from "../generated/RegistryReceiverV0/RegistryReceiverV0";
import { EthPlaysV0 } from "../generated/EthPlaysV0/EthPlaysV0";
import { FeedItem, GameState, Player } from "../generated/schema";

const POKE_ADDRESS = "0x13355f08e57378ff692a9C00c6DE7eD9463fe1a2";
const REGISTRYRECEIVERV0_ADDRESS = "0xA6EDa547736a974931b6ABf0EBBc0B0D3dE0E37b";
const ETHPLAYSV0_ADDRESS = "0x74631b389147C25d17e7255C4e5b72a958AEDf11";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function buildPokeContract(): Poke {
  return Poke.bind(Address.fromString(POKE_ADDRESS));
}

function buildRegistryReceiverContract(): RegistryReceiverV0 {
  return RegistryReceiverV0.bind(
    Address.fromString(REGISTRYRECEIVERV0_ADDRESS)
  );
}

function buildEthPlaysContract(): EthPlaysV0 {
  return EthPlaysV0.bind(Address.fromString(ETHPLAYSV0_ADDRESS));
}

function buildFeedItemEntity(event: ethereum.Event): FeedItem {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const entity = new FeedItem(id);

  entity.timestamp = event.block.timestamp.toU32();
  entity.feedIndex = event.block.number
    .times(BigInt.fromU32(100000))
    .plus(event.logIndex);

  return entity;
}

function buildGameStateEntity(): GameState {
  let entity = GameState.load("0");
  if (!entity) {
    const ethPlays = buildEthPlaysContract();

    entity = new GameState("0");
    entity.isActive = ethPlays.isActive();

    entity.inputIndex = ethPlays.inputIndex();
    entity.inputTimestamp = 0;

    entity.alignmentVoteCooldown = ethPlays.alignmentVoteCooldown().toU32();
    entity.alignmentDecayRate = ethPlays.alignmentDecayRate().toU32();
    entity.alignment = ethPlays.alignment();
    entity.chaosVoteReward = ethPlays.chaosVoteReward();

    entity.orderDuration = ethPlays.orderDuration().toU32();
    entity.orderVotes = [0, 0, 0, 0, 0, 0, 0, 0];

    entity.chaosInputRewardCooldown = ethPlays
      .chaosInputRewardCooldown()
      .toU32();
    entity.chaosInputReward = ethPlays.chaosInputReward();
    entity.orderInputReward = ethPlays.orderInputReward();
    entity.chatCost = ethPlays.chatCost();
    entity.rareCandyCost = ethPlays.rareCandyCost();

    entity.controlAuctionDuration = ethPlays.controlAuctionDuration().toU32();
    entity.controlDuration = ethPlays.controlDuration().toU32();

    entity.controlAuctionStartTimestamp = 0;
    entity.controlAuctionEndTimestamp = 0;
    entity.bestControlBidFrom = Bytes.empty();
    entity.bestControlBidAmount = BigInt.fromU32(0);
    entity.controlAddress = Bytes.empty();
  }

  return entity;
}

// The ID of a Player entity is the burner account address.
function buildPlayerEntity(id: string): Player {
  let entity = Player.load(id);
  if (!entity) {
    entity = new Player(id);
    entity.account = Bytes.empty();
    entity.replacedAt = 0;

    entity.balance = BigInt.fromU32(0);
    entity.score = BigInt.fromU32(0);

    entity.alignmentVoteTimestamp = 0;
    entity.inputVoteIndex = 0;
    entity.chaosInputTimestamp = 0;

    entity.alignmentVoteCount = 0;
    entity.chatCount = 0;
    entity.rareCandyCount = 0;

    entity.controlCount = 0;
  }

  return entity;
}

export {
  ZERO_ADDRESS,
  // Contract builders
  buildPokeContract,
  buildEthPlaysContract,
  buildRegistryReceiverContract,
  // Entity builders
  buildFeedItemEntity,
  buildGameStateEntity,
  buildPlayerEntity,
};
