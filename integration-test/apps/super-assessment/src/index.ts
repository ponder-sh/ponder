import { type Context, type Event, ponder } from "ponder:registry";
import {
  blocks,
  checkpoints,
  logs,
  traces,
  transactionReceipts,
  transactions,
} from "ponder:schema";
import { ZERO_CHECKPOINT_STRING } from "../../../../packages/core/src/utils/checkpoint";
import config from "../ponder.config";

const callback = async (name: string, event: Event, context: Context) => {
  const checkpoint = await context.db.find(checkpoints, {
    chainId: context.chain.id,
  });
  if (event.id < checkpoint?.id ?? ZERO_CHECKPOINT_STRING)
    throw new Error("Out of order event");

  await context.db
    .insert(checkpoints)
    .values({
      chainId: context.chain.id,
      id: event.id,
    })
    .onConflictDoUpdate({
      id: event.id,
    });

  if (event.block) {
    await context.db.insert(blocks).values({
      name,
      id: event.id,
      chainId: context.chain.id,
      number: Number(event.block.number),
      hash: event.block.hash,
    });
  }

  if (event.transaction) {
    await context.db.insert(transactions).values({
      name,
      id: event.id,
      chainId: context.chain.id,
      transactionIndex: event.transaction.transactionIndex,
      hash: event.transaction.hash,
    });
  }

  if (event.transactionReceipt) {
    await context.db.insert(transactionReceipts).values({
      name,
      id: event.id,
      chainId: context.chain.id,
      transactionIndex: event.transaction.transactionIndex,
      hash: event.transaction.hash,
    });
  }

  if (event.trace) {
    await context.db.insert(traces).values({
      name,
      id: event.id,
      chainId: context.chain.id,
      traceIndex: event.trace.traceIndex,
      hash: event.trace.hash,
    });
  }

  if (event.log) {
    await context.db.insert(logs).values({
      name,
      id: event.id,
      chainId: context.chain.id,
      logIndex: event.log.logIndex,
    });
  }
};

for (const name of Object.keys(config.contracts)) {
  ponder.on(`${name}:Transfer`, async ({ event, context }) => {
    await callback(`${name}:Transfer`, event, context);
  });

  ponder.on(`${name}.transfer()`, async ({ event, context }) => {
    await callback(`${name}.transfer()`, event, context);
  });
}

for (const name of Object.keys(config.accounts)) {
  ponder.on(`${name}:transaction:from`, async ({ event, context }) => {
    await callback(`${name}:transaction:from`, event, context);
  });

  ponder.on(`${name}:transaction:to`, async ({ event, context }) => {
    await callback(`${name}:transaction:to`, event, context);
  });

  ponder.on(`${name}:transfer:from`, async ({ event, context }) => {
    await callback(`${name}:transfer:from`, event, context);
  });

  ponder.on(`${name}:transfer:to`, async ({ event, context }) => {
    await callback(`${name}:transfer:to`, event, context);
  });
}

for (const name of Object.keys(config.blocks)) {
  ponder.on(`${name}:block`, async ({ event, context }) => {
    await callback(`${name}:block`, event, context);
  });
}
