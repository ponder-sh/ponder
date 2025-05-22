import { ponder } from "ponder:registry";
import { state, table } from "ponder:schema";
import config from "../ponder.config";

// TODO(kyle) build indexing functions based on `ponder.config.ts`
// TODO(kyle) add content assertions

for (const name of Object.keys(config.contracts)) {
  ponder.on(
    `${name as keyof typeof config.contracts}:setup`,
    async ({ context }) => {
      const { serial } = await context.db
        .insert(state)
        .values({
          chainId: context.chain.id,
          serial: 0,
        })
        .onConflictDoUpdate({});

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: `${name as keyof typeof config.contracts}:setup`,
        name: `${name as keyof typeof config.contracts}:setup`,
        serial,
      });
    },
  );

  ponder.on(
    `${name as keyof typeof config.contracts}:Transfer`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.contracts}:Transfer`,
        serial,
      });
    },
  );

  ponder.on(
    `${name as keyof typeof config.contracts}.transfer()`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.contracts}.transfer()`,
        serial,
      });
    },
  );
}

for (const name of Object.keys(config.accounts)) {
  ponder.on(
    `${name as keyof typeof config.accounts}:transaction:from`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.accounts}:transaction:from`,
        serial,
      });
    },
  );

  ponder.on(
    `${name as keyof typeof config.accounts}:transaction:to`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.accounts}:transaction:to`,
        serial,
      });
    },
  );

  ponder.on(
    `${name as keyof typeof config.accounts}:transfer:from`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.accounts}:transfer:from`,
        serial,
      });
    },
  );

  ponder.on(
    `${name as keyof typeof config.accounts}:transfer:to`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.accounts}:transfer:to`,
        serial,
      });
    },
  );
}

for (const name of Object.keys(config.blocks)) {
  ponder.on(
    `${name as keyof typeof config.blocks}:block`,
    async ({ event, context }) => {
      const { serial } = await context.db
        .update(state, { chainId: context.chain.id })
        .set((row) => ({
          serial: row.serial + 1,
        }));

      await context.db.insert(table).values({
        chainId: context.chain.id,
        id: event.id,
        name: `${name as keyof typeof config.blocks}:block`,
        serial,
      });
    },
  );
}
