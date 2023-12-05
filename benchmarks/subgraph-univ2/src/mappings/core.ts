/* eslint-disable prefer-const */
import {
  Burn as BurnEvent,
  Mint as MintEvent,
  Pair,
  Swap as SwapEvent,
  UniswapFactory,
} from "../../generated/schema";
import type {
  Burn,
  Mint,
  Swap,
  Sync,
} from "../../generated/templates/Pair/Pair";
import { FACTORY_ADDRESS } from "./helpers";

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHex());

  pair.reserve0 = event.params.reserve0;
  pair.reserve1 = event.params.reserve1;

  pair.save();
}

export function handleMint(event: Mint): void {
  let mint = new MintEvent(
    event.transaction.hash
      .toHexString()
      .concat("-")
      .concat(event.logIndex.toHexString()),
  );

  let pair = Pair.load(event.address.toHex());
  let uniswap = UniswapFactory.load(FACTORY_ADDRESS);

  // update exchange info (except balances, sync will cover that)
  let token0Amount = event.params.amount0;
  let token1Amount = event.params.amount1;

  // update txn counts
  pair.txCount = pair.txCount + 1;
  uniswap.txCount = uniswap.txCount + 1;

  // save entities
  pair.save();
  uniswap.save();

  mint.timestamp = event.block.timestamp;
  mint.sender = event.params.sender;
  mint.amount0 = token0Amount;
  mint.amount1 = token1Amount;
  mint.logIndex = event.logIndex;
  mint.save();
}

export function handleBurn(event: Burn): void {
  let burn = new BurnEvent(
    event.transaction.hash
      .toHexString()
      .concat("-")
      .concat(event.logIndex.toHexString()),
  );

  let pair = Pair.load(event.address.toHex());
  let uniswap = UniswapFactory.load(FACTORY_ADDRESS);

  //update token info
  let token0Amount = event.params.amount0;
  let token1Amount = event.params.amount1;

  // update txn counts
  uniswap.txCount = uniswap.txCount + 1;
  pair.txCount = pair.txCount + 1;

  // update global counter and save
  pair.save();
  uniswap.save();

  // update burn
  burn.sender = event.params.sender;
  burn.timestamp = event.block.timestamp;
  burn.amount0 = token0Amount;
  burn.amount1 = token1Amount;
  burn.to = event.params.to;
  burn.logIndex = event.logIndex;
  burn.save();
}

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString());
  let amount0In = event.params.amount0In;
  let amount1In = event.params.amount1In;
  let amount0Out = event.params.amount0Out;
  let amount1Out = event.params.amount1Out;

  pair.txCount = pair.txCount + 1;

  // update global values, only used tracked amounts for volume
  let uniswap = UniswapFactory.load(FACTORY_ADDRESS);
  uniswap.txCount = uniswap.txCount + 1;

  // save entities
  pair.save();
  uniswap.save();

  let swap = new SwapEvent(
    event.transaction.hash
      .toHexString()
      .concat("-")
      .concat(event.logIndex.toHexString()),
  );

  // update swap event
  swap.pair = pair.id;
  swap.timestamp = event.block.timestamp;
  swap.sender = event.params.sender;
  swap.amount0In = amount0In;
  swap.amount1In = amount1In;
  swap.amount0Out = amount0Out;
  swap.amount1Out = amount1Out;
  swap.to = event.params.to;
  swap.from = event.transaction.from;
  swap.logIndex = event.logIndex;

  swap.save();
}
