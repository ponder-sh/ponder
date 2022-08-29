import { NewRegistration } from "../generated/RegistryReceiverV0/RegistryReceiverV0";
import { buildFeedItemEntity, buildPlayerEntity } from "./utils";

export function handleNewRegistration(event: NewRegistration): void {
  console.log("in handleNewRegistration with event:", event);

  const playerEntity = buildPlayerEntity(
    event.params.burnerAccount.toHexString()
  );
  console.log("after buildPlayerEntity");

  playerEntity.account = event.params.account;
  playerEntity.save();

  const feedItemEntity = buildFeedItemEntity(event);
  feedItemEntity.type = "NewRegistration";
  feedItemEntity.from = event.params.burnerAccount;
  feedItemEntity.account = event.params.account;
  feedItemEntity.save();
}
