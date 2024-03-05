import { ponder } from "./ponder-env.js";

ponder.on("C:Event2", async ({ event, context }) => {
  const { Table1: Table } = context.db;

  await Table.upsert({
    id: event.args.arg,
  });
});
