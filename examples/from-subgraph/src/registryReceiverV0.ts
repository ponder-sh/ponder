import { NewRegistration } from "../generated/RegistryReceiverV0/RegistryReceiverV0";
import { buildFeedItemEntity, buildPlayerEntity } from "./utils";

export function handleNewRegistration(event: NewRegistration): void {
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
