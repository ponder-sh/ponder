import type { Address } from "viem";

import { ponder } from "@/generated";

ponder.on("UniswapV3Pool:Flash", async ({ event, context }) => {
  const { PoolTokens, TokenBorrowed, TokenPaid } = context.db;
  const poolAddress = event.log.address;

  let token0: Address;
  let token1: Address;

  const tokens = await PoolTokens.findUnique({ id: poolAddress });
  if (tokens) {
    token0 = tokens.token0 as Address;
    token1 = tokens.token1 as Address;
  } else {
    token0 = await context.client.readContract({
      abi: context.contracts.UniswapV3Pool.abi,
      functionName: "token0",
      address: poolAddress,
    });
    token1 = await context.client.readContract({
      abi: context.contracts.UniswapV3Pool.abi,
      functionName: "token1",
      address: poolAddress,
    });

    await PoolTokens.create({
      id: poolAddress,
      data: {
        token0,
        token1,
      },
    });
  }

  await TokenBorrowed.upsert({
    id: token0,
    create: {
      amount: event.args.amount0,
    },
    update: ({ current }) => ({
      amount: current.amount + event.args.amount0,
    }),
  });
  await TokenBorrowed.upsert({
    id: token1,
    create: {
      amount: event.args.amount1,
    },
    update: ({ current }) => ({
      amount: current.amount + event.args.amount1,
    }),
  });

  await TokenPaid.upsert({
    id: token0,
    create: {
      amount: event.args.paid0,
    },
    update: ({ current }) => ({
      amount: current.amount + event.args.paid0,
    }),
  });
  await TokenPaid.upsert({
    id: token1,
    create: {
      amount: event.args.paid1,
    },
    update: ({ current }) => ({
      amount: current.amount + event.args.paid1,
    }),
  });
});
