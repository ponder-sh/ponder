import {
  NewRegistration,
  UpdatedRegistration,
} from "../generated/RegistryReceiverV0/RegistryReceiverV0";
import { Player } from "../generated/schema";
import {
  buildFeedItemEntity,
  buildGameStateEntity,
  buildPlayerEntity,
} from "./utils";

export function handleNewRegistration(event: NewRegistration): void {
  // hack, calling this like a setup script lol
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.save();

  const playerEntity = buildPlayerEntity(
    event.params.burnerAccount.toHexString()
  );
  playerEntity.account = event.params.account;
  playerEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "NewRegistration";
  feedItemEntity.from = event.params.burnerAccount;
  feedItemEntity.account = event.params.account;
  feedItemEntity.save();
}

export function handleUpdatedRegistration(event: UpdatedRegistration): void {
  // Replace / invalidate previous Player entity
  const previousPlayerEntity = Player.load(
    event.params.previousBurnerAccount.toHexString()
  );
  if (previousPlayerEntity) {
    previousPlayerEntity.replacedAt = event.block.timestamp.toU32();
    previousPlayerEntity.save();
  }

  // Create new Player entity
  const playerEntity = buildPlayerEntity(
    event.params.burnerAccount.toHexString()
  );
  playerEntity.account = event.params.account;
  playerEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "UpdatedRegistration";
  feedItemEntity.from = event.params.burnerAccount;
  feedItemEntity.account = event.params.account;
  feedItemEntity.save();
}
