import { ponder } from "ponder:registry";
import { table } from "ponder:schema";
import { ZERO_CHECKPOINT_STRING } from "../../../../packages/core/src/utils/checkpoint";
import config from "../ponder.config";

let checkpoint: string;

for (const name of Object.keys(config.contracts)) {
  ponder.on(`${name}:setup`, async ({ context }) => {
    checkpoint = ZERO_CHECKPOINT_STRING;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:setup`,
      id: checkpoint,
    });
  });

  ponder.on(`${name}:Transfer`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:Transfer`,
      id: checkpoint,
    });
  });

  ponder.on(`${name}.transfer()`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}.transfer()`,
      id: checkpoint,
    });
  });
}

for (const name of Object.keys(config.accounts)) {
  ponder.on(`${name}:transaction:from`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transaction:from`,
      id: checkpoint,
    });
  });

  ponder.on(`${name}:transaction:to`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transaction:to`,
      id: checkpoint,
    });
  });

  ponder.on(`${name}:transfer:from`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transfer:from`,
      id: checkpoint,
    });
  });

  ponder.on(`${name}:transfer:to`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transfer:to`,
      id: checkpoint,
    });
  });
}

for (const name of Object.keys(config.blocks)) {
  ponder.on(`${name}:block`, async ({ event, context }) => {
    if (event.id < checkpoint) throw new Error("Out of order event");

    checkpoint = event.id;

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:block`,
      id: checkpoint,
    });
  });
}
