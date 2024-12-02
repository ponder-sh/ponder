import { ponder } from "ponder:registry";
import * as schema from "../ponder.schema";

ponder.on("BeaverBuilder:transaction:from", async ({ event, context }) => {
  if (event.transaction.to === null) return;

  await context.db
    .insert(schema.transactionEvents)
    .values({
      to: event.transaction.to,
      value: event.transaction.value,
      data: event.transaction.input,
    })
    .onConflictDoUpdate((row) => ({
      value: row.value + event.transaction.value,
      data: event.transaction.input,
    }));
});

ponder.on("BeaverBuilder:transfer:to", async ({ event }) => {
  console.log("sent", event.transfer);
});
