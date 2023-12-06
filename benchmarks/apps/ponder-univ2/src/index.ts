import { getAddress } from "viem";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { ponder } from "@/generated";

declare const ponder: import("@ponder/core").PonderApp<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js").default
>;

ponder.on("Factory:PairCreated", async ({ event, context }) => {
  const { UniswapFactory, Pair } = context.db;

  await UniswapFactory.upsert({
    id: getAddress(context.contracts.Factory.address),
    create: {
      pairCount: 0,
      txCount: 0,
    },
    update: ({ current }) => ({
      pairCount: current.pairCount + 1,
      txCount: current.pairCount + 1,
    }),
  });

  await Pair.create({
    id: getAddress(event.args.pair),
    data: {
      token0: event.args.token0,
      token1: event.args.token1,
      totalSupply: 0n,
      reserve0: 0n,
      reserve1: 0n,
      txCount: 0,
      createdAtBlockNumber: event.block.number,
      createdAtTimestamp: event.block.timestamp,
    },
  });
});

ponder.on("Pair:Sync", async ({ event, context }) => {
  await context.db.Pair.update({
    id: getAddress(event.log.address),
    data: { reserve0: event.args.reserve0, reserve1: event.args.reserve1 },
  });
});

ponder.on("Pair:Mint", async ({ event, context }) => {
  await context.db.UniswapFactory.update({
    id: getAddress(context.contracts.Factory.address),
    data: ({ current }) => ({
      txCount: current.txCount + 1,
    }),
  });

  await context.db.Pair.update({
    id: getAddress(event.log.address),
    data: ({ current }) => ({
      txCount: current.txCount + 1,
    }),
  });

  await context.db.Mint.create({
    id: event.log.id,
    data: {
      pair: getAddress(event.log.address),
      timestamp: event.block.timestamp,
      sender: event.args.sender,
      amount0: event.args.amount0,
      amount1: event.args.amount1,
      logIndex: event.log.logIndex,
    },
  });
});

ponder.on("Pair:Burn", async ({ event, context }) => {
  await context.db.UniswapFactory.update({
    id: getAddress(context.contracts.Factory.address),
    data: ({ current }) => ({
      txCount: current.txCount + 1,
    }),
  });

  await context.db.Pair.update({
    id: getAddress(event.log.address),
    data: ({ current }) => ({
      txCount: current.txCount + 1,
    }),
  });

  await context.db.Burn.create({
    id: event.log.id,
    data: {
      pair: getAddress(event.log.address),
      timestamp: event.block.timestamp,
      sender: event.args.sender,
      to: event.args.sender,
      amount0: event.args.amount0,
      amount1: event.args.amount1,
      logIndex: event.log.logIndex,
    },
  });
});

ponder.on("Pair:Swap", async ({ event, context }) => {
  await context.db.UniswapFactory.update({
    id: getAddress(context.contracts.Factory.address),
    data: ({ current }) => ({
      txCount: current.txCount + 1,
    }),
  });

  await context.db.Pair.update({
    id: getAddress(event.log.address),
    data: ({ current }) => ({
      txCount: current.txCount + 1,
    }),
  });

  await context.db.Swap.create({
    id: event.log.id,
    data: {
      pair: getAddress(event.log.address),
      timestamp: event.block.timestamp,
      sender: event.args.sender,
      from: event.transaction.from,
      to: event.args.sender,
      amount0In: event.args.amount0In,
      amount1In: event.args.amount1In,
      amount0Out: event.args.amount0Out,
      amount1Out: event.args.amount1Out,
      logIndex: event.log.logIndex,
    },
  });
});
