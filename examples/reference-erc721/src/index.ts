import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("ERC721:Transfer", async ({ event, context }) => {
  // Create an Account for the sender, or update the balance if it already exists.
  await context.db
    .upsert(schema.account, { address: event.args.from })
    .insert({});
  // Create an Account for the recipient, or update the balance if it already exists.
  await context.db
    .upsert(schema.account, { address: event.args.to })
    .insert({});

  // Create or update a Token.
  await context.db
    .upsert(schema.token, { id: event.args.id })
    .insert({
      owner: event.args.to,
    })
    .update({ owner: event.args.to });

  // Create a TransferEvent.
  await context.db.insert(schema.transferEvent).values({
    from: event.args.from,
    to: event.args.to,
    token: event.args.id,
    timestamp: Number(event.block.timestamp),
  });
});
