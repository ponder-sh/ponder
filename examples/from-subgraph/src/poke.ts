import { SetGameAddress, Transfer } from "../generated/Poke/Poke";
import { buildGameStateEntity, buildPlayerEntity, ZERO_ADDRESS } from "./utils";

export function handleTransfer(event: Transfer): void {
  const from = event.params.from.toHexString();
  const to = event.params.to.toHexString();
  const amount = event.params.value;

  if (from != ZERO_ADDRESS) {
    const playerEntityFrom = buildPlayerEntity(from);
    playerEntityFrom.balance = playerEntityFrom.balance.minus(amount);
    playerEntityFrom.save();
  }

  if (to != ZERO_ADDRESS) {
    const playerEntityTo = buildPlayerEntity(to);
    playerEntityTo.balance = playerEntityTo.balance.plus(amount);
    playerEntityTo.save();
  }
}

export function handleSetGameAddress(event: SetGameAddress): void {
  const gameStateEntity = buildGameStateEntity();
  gameStateEntity.save();
}
