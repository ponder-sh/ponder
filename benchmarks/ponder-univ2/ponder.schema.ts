import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  UniswapFactory: p.createTable({
    id: p.string(),
    pairCount: p.int(),
    txCount: p.int(),
  }),

  Pair: p.createTable({
    id: p.string(),

    token0: p.string(),
    token1: p.string(),
    reserve0: p.bigint(),
    reserve1: p.bigint(),
    totalSupply: p.bigint(),

    txCount: p.int(),

    createdAtTimestamp: p.bigint(),
    createdAtBlockNumber: p.bigint(),

    mints: p.many("Mint.pair"),
    burns: p.many("Burn.pair"),
    swaps: p.many("Swap.pair"),
  }),
  Mint: p.createTable({
    id: p.string(),
    timestamp: p.bigint(),
    pair: p.string().references("Pair.id"),

    sender: p.string(),
    amount0: p.bigint(),
    amount1: p.bigint(),

    logIndex: p.int(),
  }),
  Burn: p.createTable({
    id: p.string(),
    timestamp: p.bigint(),
    pair: p.string().references("Pair.id"),

    sender: p.string(),
    amount0: p.bigint(),
    amount1: p.bigint(),
    to: p.string(),

    logIndex: p.int(),
  }),
  Swap: p.createTable({
    id: p.string(),
    timestamp: p.bigint(),
    pair: p.string().references("Pair.id"),

    sender: p.string(),
    from: p.string(),
    amount0In: p.bigint(),
    amount1In: p.bigint(),
    amount0Out: p.bigint(),
    amount1Out: p.bigint(),
    to: p.string(),

    logIndex: p.int(),
  }),
}));
