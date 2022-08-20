import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";

import { FeedItem, Player } from "../generated/schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function buildFeedItemEntity(event: ethereum.Event): FeedItem {
  const id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const entity = new FeedItem(id);

  entity.timestamp = event.block.timestamp.toU32();
  entity.feedIndex = event.block.number
    .times(BigInt.fromU32(100000))
    .plus(event.logIndex);

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

export { buildFeedItemEntity, buildPlayerEntity, ZERO_ADDRESS };
