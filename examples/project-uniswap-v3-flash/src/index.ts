import { ponder } from "@/generated";

ponder.on("UniswapV3Pool:Flash", async ({ event, context }) => {
  const { TokenBorrowed, TokenPaid } = context.db;
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
