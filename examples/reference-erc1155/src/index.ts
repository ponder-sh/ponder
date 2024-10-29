import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC1155:TransferSingle", async ({ event, context }) => {
  // Create an Account for the sender, or update the balance if it already exists.
  await context.db
    .upsert(schema.account, { address: event.args.from })
    .insert({});

  await context.db
    .upsert(schema.tokenBalance, {
      owner: event.args.from,
      tokenId: event.args.id,
    })
    .insert({
      balance: -event.args.amount,
    })
    .update((row) => ({
      balance: row.balance - event.args.amount,
    }));

  // Create an Account for the recipient, or update the balance if it already exists.
  await context.db
    .upsert(schema.account, { address: event.args.to })
    .insert({});

  await context.db
    .upsert(schema.tokenBalance, {
      owner: event.args.to,
      tokenId: event.args.id,
    })
    .insert({
      balance: event.args.amount,
    })
    .update((row) => ({
      balance: row.balance + event.args.amount,
    }));

  // Create a TransferEvent.
  await context.db.insert(schema.transferEvent).values({
    from: event.args.from,
    to: event.args.to,
    token: event.args.id,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("ERC1155:TransferBatch", async ({ event, context }) => {
  await context.db
    .upsert(schema.account, { address: event.args.from })
    .insert({});
  await context.db
    .upsert(schema.account, { address: event.args.to })
    .insert({});

  for (let i = 0; i < event.args.ids.length; i++) {
    const id = event.args.ids[i]!;
    const amount = event.args.amounts[i]!;

    await context.db
      .upsert(schema.tokenBalance, {
        owner: event.args.from,
        tokenId: id,
      })
      .insert({
        balance: -amount,
      })
      .update((row) => ({
        balance: row.balance - amount,
      }));

    await context.db
      .upsert(schema.tokenBalance, {
        owner: event.args.to,
        tokenId: id,
      })
      .insert({
        balance: amount,
      })
      .update((row) => ({
        balance: row.balance + amount,
      }));

    await context.db.insert(schema.transferEvent).values({
      from: event.args.from,
      to: event.args.to,
      token: id,
      timestamp: Number(event.block.timestamp),
    });
  }
});
