import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("PoolManager:Initialize", async ({ event, context }) => {
  await context.db.insert(schema.pool).values({
    poolId: event.args.id,
    currency0: event.args.currency0,
    currency1: event.args.currency1,
    fee: event.args.fee,
    tickSpacing: event.args.tickSpacing,
    hooks: event.args.hooks,
    chainId: context.chain.id,
  });
});

ponder.on("PoolManager:Swap", async ({ event, context }) => {
  await context.db.insert(schema.swap).values({
    id: event.id,
    poolId: event.args.id,
    sender: event.args.sender,
    amount0: event.args.amount0,
    amount1: event.args.amount1,
    sqrtPriceX96: event.args.sqrtPriceX96,
    liquidity: event.args.liquidity,
    tick: event.args.tick,
    fee: event.args.fee,
    chainId: context.chain.id,
  });
});
