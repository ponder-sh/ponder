import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("UniswapV3Pool:Flash", async ({ event, context }) => {
  const poolAddress = event.log.address;

  const [token0, token1] = await Promise.all([
    context.client.readContract({
      abi: context.contracts.UniswapV3Pool.abi,
      functionName: "token0",
      address: poolAddress,
      cache: "immutable",
    }),
    context.client.readContract({
      abi: context.contracts.UniswapV3Pool.abi,
      functionName: "token1",
      address: poolAddress,
      cache: "immutable",
    }),
  ]);

  await context.db
    .upsert(schema.tokenBorrowed, { address: token0 })
    .insert({
      amount: event.args.amount0,
    })
    .update((row) => ({ amount: row.amount + event.args.amount0 }));
  await context.db
    .upsert(schema.tokenBorrowed, { address: token1 })
    .insert({
      amount: event.args.amount1,
    })
    .update((row) => ({ amount: row.amount + event.args.amount1 }));
  await context.db
    .upsert(schema.tokenPaid, { address: token0 })
    .insert({
      amount: event.args.paid0,
    })
    .update((row) => ({ amount: row.amount + event.args.amount0 }));
  await context.db
    .upsert(schema.tokenPaid, { address: token1 })
    .insert({
      amount: event.args.paid1,
    })
    .update((row) => ({ amount: row.amount + event.args.amount1 }));
});
