/* eslint-disable prefer-const */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PairCreated } from "../../generated/Factory/Factory";
import { Pair, UniswapFactory } from "../../generated/schema";
import { Pair as PairTemplate } from "../../generated/templates";
import { FACTORY_ADDRESS, ZERO_BI } from "./helpers";

export function handleNewPair(event: PairCreated): void {
  // load factory (create if first exchange)
  let factory = UniswapFactory.load(FACTORY_ADDRESS);
  if (factory === null) {
    factory = new UniswapFactory(FACTORY_ADDRESS);
    factory.pairCount = 0;
    factory.txCount = 0;
  }
  factory.pairCount = factory.pairCount + 1;
  factory.save();

  let pair = new Pair(event.params.pair.toHexString()) as Pair;
  pair.token0 = event.params.token0;
  pair.token1 = event.params.token1;
  pair.createdAtTimestamp = event.block.timestamp;
  pair.createdAtBlockNumber = event.block.number;
  pair.txCount = 0;
  pair.reserve0 = ZERO_BI;
  pair.reserve1 = ZERO_BI;

  pair.totalSupply = ZERO_BI;

  // create the tracked contract based on the template
  PairTemplate.create(event.params.pair);

  // save updated values

  pair.save();
  factory.save();
}
