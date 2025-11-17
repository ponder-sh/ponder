import { ponder } from "ponder:registry";
import schema from "ponder:schema";

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
    .insert(schema.tokenBorrowed)
    .values({
      address: token0,
      amount: event.args.amount0,
    })
    .onConflictDoUpdate((row) => ({ amount: row.amount + event.args.amount0 }));
  await context.db
    .insert(schema.tokenBorrowed)
    .values({
      address: token1,
      amount: event.args.amount1,
    })
    .onConflictDoUpdate((row) => ({ amount: row.amount + event.args.amount1 }));
  await context.db
    .insert(schema.tokenPaid)
    .values({
      address: token0,
      amount: event.args.paid0,
    })
    .onConflictDoUpdate((row) => ({ amount: row.amount + event.args.amount0 }));
  await context.db
    .insert(schema.tokenPaid)
    .values({
      address: token1,
      amount: event.args.paid1,
    })
    .onConflictDoUpdate((row) => ({ amount: row.amount + event.args.amount1 }));
});
