import { ponder } from "ponder:registry";
import { burn, factory, mint, pair, swap } from "ponder:schema";

ponder.on("Factory:PairCreated", async ({ event, context }) => {
  await context.db
    .insert(factory)
    .values({
      id: context.contracts.Factory.address,
      pairCount: 0,
      txCount: 0,
    })
    .onConflictDoUpdate((row) => ({
      pairCount: row.pairCount + 1,
      txCount: row.txCount + 1,
    }));

  await context.db.insert(pair).values({
    id: event.args.pair,
    token0: event.args.token0,
    token1: event.args.token1,
    totalSupply: 0n,
    reserve0: 0n,
    reserve1: 0n,
    txCount: 0,
    createdAtBlockNumber: event.block.number,
    createdAtTimestamp: event.block.timestamp,
  });
});

ponder.on("Pair:Sync", async ({ event, context }) => {
  await context.db.update(pair, { id: event.log.address }).set({
    reserve0: event.args.reserve0,
    reserve1: event.args.reserve1,
  });
});

ponder.on("Pair:Mint", async ({ event, context }) => {
  await context.db
    .update(factory, { id: context.contracts.Factory.address })
    .set((row) => ({
      txCount: row.txCount + 1,
    }));

  await context.db.update(pair, { id: event.log.address }).set((row) => ({
    txCount: row.txCount + 1,
  }));

  await context.db.insert(mint).values({
    id: event.id,
    pair: event.log.address,
    timestamp: event.block.timestamp,
    sender: event.args.sender,
    amount0: event.args.amount0,
    amount1: event.args.amount1,
    logIndex: event.log.logIndex,
  });
});

ponder.on("Pair:Burn", async ({ event, context }) => {
  await context.db
    .update(factory, { id: context.contracts.Factory.address })
    .set((row) => ({
      txCount: row.txCount + 1,
    }));

  await context.db.update(pair, { id: event.log.address }).set((row) => ({
    txCount: row.txCount + 1,
  }));

  await context.db.insert(burn).values({
    id: event.id,
    pair: event.log.address,
    timestamp: event.block.timestamp,
    sender: event.args.sender,
    to: event.args.sender,
    amount0: event.args.amount0,
    amount1: event.args.amount1,
    logIndex: event.log.logIndex,
  });
});

ponder.on("Pair:Swap", async ({ event, context }) => {
  await context.db
    .update(factory, { id: context.contracts.Factory.address })
    .set((row) => ({ txCount: row.txCount + 1 }));

  await context.db.update(pair, { id: event.log.address }).set((row) => ({
    txCount: row.txCount + 1,
  }));

  await context.db.insert(swap).values({
    id: event.id,
    pair: event.log.address,
    timestamp: event.block.timestamp,
    sender: event.args.sender,
    from: event.transaction.from,
    to: event.args.sender,
    amount0In: event.args.amount0In,
    amount1In: event.args.amount1In,
    amount0Out: event.args.amount0Out,
    amount1Out: event.args.amount1Out,
    logIndex: event.log.logIndex,
  });
});
