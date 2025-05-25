import { ponder } from "ponder:registry";
import { checkpoints, table } from "ponder:schema";
import { ZERO_CHECKPOINT_STRING } from "../../../../packages/core/src/utils/checkpoint";
import config from "../ponder.config";

for (const name of Object.keys(config.contracts)) {
  // @ts-ignore
  ponder.on(`${name}:setup`, async ({ context }) => {
    await context.db
      .insert(checkpoints)
      .values({
        chainId: context.chain.id,
        id: ZERO_CHECKPOINT_STRING,
      })
      .onConflictDoNothing();

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:setup`,
      id: ZERO_CHECKPOINT_STRING,
    });
  });

  // @ts-ignore
  ponder.on(`${name}:Transfer`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:Transfer`,
      id: event.id,
    });
  });

  // @ts-ignore
  ponder.on(`${name}.transfer()`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}.transfer()`,
      id: event.id,
    });
  });
}

for (const name of Object.keys(config.accounts)) {
  // @ts-ignore
  ponder.on(`${name}:transaction:from`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transaction:from`,
      id: event.id,
    });
  });

  // @ts-ignore
  ponder.on(`${name}:transaction:to`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    if (event.block.number === 133000941n) {
      console.log(event.id, event.transaction.to);
    }

    // if (
    //   event.transaction.to?.toLowerCase() ===
    //     "0x67ccea5bb16181e7b4109c9c2143c24a1c2205be" ||
    //   event.transaction.to?.toLowerCase() ===
    //     "0xfdb794692724153d1488ccdbe0c56c252596735f"
    // ) {
    //   console.log(event.id);
    // }

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transaction:to`,
      id: event.id,
    });
  });

  // @ts-ignore
  ponder.on(`${name}:transfer:from`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transfer:from`,
      id: event.id,
    });
  });

  // @ts-ignore
  ponder.on(`${name}:transfer:to`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:transfer:to`,
      id: event.id,
    });
  });
}

for (const name of Object.keys(config.blocks)) {
  // @ts-ignore
  ponder.on(`${name}:block`, async ({ event, context }) => {
    const checkpoint = await context.db.find(checkpoints, {
      chainId: context.chain.id,
    });
    if (event.id < checkpoint!.id) throw new Error("Out of order event");

    await context.db.update(checkpoints, { chainId: context.chain.id }).set({
      id: event.id,
    });

    await context.db.insert(table).values({
      chainId: context.chain.id,
      name: `${name}:block`,
      id: event.id,
    });
  });
}
