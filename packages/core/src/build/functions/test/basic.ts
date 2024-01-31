import { ponder } from "./ponder-env.js";

ponder.on("C:Event1", async ({ event, context }) => {
  await context.db.Table1.upsert({
    id: event.args.arg,
  });
});

ponder.on("C:Event2", async ({ event, context }) => {
  const { Table1 } = context.db;

  await Table1.upsert({
    id: event.args.arg,
  });
});
